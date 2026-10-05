import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import { configPath, toggleTabs, type VisibleMode } from "../src/config"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(text?: string) {
  const directory = await mkdtemp(join(tmpdir(), "opencode-tabs-toggle-"))
  directories.push(directory)
  const path = join(directory, "cli.json")
  if (text !== undefined) await writeFile(path, text, { mode: 0o600 })
  let previousMode: VisibleMode = "auto"
  return {
    path,
    read: async () => parse(await readFile(path, "utf8")),
    toggle: (inlineConfig?: string, remember?: (mode: VisibleMode) => Promise<void>) => toggleTabs({
      path,
      previousMode,
      inlineConfig,
      remember: remember ?? (async (mode) => { previousMode = mode }),
    }),
  }
}

test("hide and restore both visible modes without changing other preferences", async () => {
  for (const mode of ["on", "auto"] as const) {
    const original = { tabs: { mode, layout: "vertical", scope: "global" }, theme: { name: "tokyonight" }, plugins: ["other"] }
    const file = await fixture(JSON.stringify(original))
    expect(await file.toggle()).toBe("off")
    expect(await file.read()).toEqual({ ...original, tabs: { ...original.tabs, mode: "off" } })
    expect(await file.toggle()).toBe(mode)
    expect(await file.read()).toEqual(original)
  }
})

test("starts hidden with no previous mode and restores auto", async () => {
  const file = await fixture('{"tabs":{"mode":"off"}}')
  expect(await file.toggle()).toBe("auto")
})

test("handles legacy tabs.enabled without removing it", async () => {
  const file = await fixture('{"tabs":{"enabled":false,"layout":"vertical"}}')
  expect(await file.toggle()).toBe("auto")
  expect((await file.read()).tabs.enabled).toBe(false)
  expect(await file.toggle()).toBe("off")
})

test("preserves comments and unrelated JSONC formatting", async () => {
  const file = await fixture('{\n  // preferences\n  "theme": {"name": "catppuccin"},\n  "tabs": {"mode": "on", "layout": "vertical"},\n}\n')
  await file.toggle()
  expect(await readFile(file.path, "utf8")).toContain('// preferences\n  "theme": {"name": "catppuccin"}')
  expect((await file.read()).tabs.mode).toBe("off")
})

test("creates a private CLI config when absent", async () => {
  const file = await fixture()
  await file.toggle()
  expect(await file.read()).toEqual({ $schema: "https://opencode.ai/v2/cli.json", tabs: { mode: "off" } })
  expect((await stat(file.path)).mode & 0o777).toBe(0o600)
})

test("follows an existing config symlink without replacing it", async () => {
  const file = await fixture('{"tabs":{"mode":"on"}}')
  const link = join(file.path, "..", "link.json")
  await symlink(file.path, link)
  await toggleTabs({ path: link, previousMode: "auto", remember: async () => {} })
  expect(await readlink(link)).toBe(file.path)
  expect((await file.read()).tabs.mode).toBe("off")
})

test("refuses inline tab overrides without editing the CLI file", async () => {
  const text = '{"tabs":{"mode":"on"}}'
  const file = await fixture(text)
  for (const inline of ['{"tabs":{"mode":"auto"}}', '{"tabs":{"enabled":true}}']) {
    await expect(file.toggle(inline)).rejects.toThrow("OPENCODE_CLI_CONFIG_CONTENT")
    expect(await readFile(file.path, "utf8")).toBe(text)
  }
  expect(await file.toggle('{"tabs":{"layout":"vertical"}}')).toBe("off")
})

test("refuses malformed config rather than overwriting it", async () => {
  for (const text of ['{"tabs":', '[]', '{"tabs":null}', '{"tabs":{"mode":"invalid"}}']) {
    const file = await fixture(text)
    await expect(file.toggle()).rejects.toThrow()
    expect(await readFile(file.path, "utf8")).toBe(text)
  }
})

test("detects edits during the toggle and preserves the newer config", async () => {
  const file = await fixture('{"tabs":{"mode":"on"}}')
  const updated = '{"tabs":{"mode":"auto"},"mouse":false}'
  await expect(file.toggle(undefined, async () => { await writeFile(file.path, updated) })).rejects.toThrow("changed while toggling")
  expect(await readFile(file.path, "utf8")).toBe(updated)
})

test("failed persistence leaves the config untouched", async () => {
  const text = '{"tabs":{"mode":"on"}}'
  const file = await fixture(text)
  await expect(file.toggle(undefined, async () => { throw new Error("storage unavailable") })).rejects.toThrow("storage unavailable")
  expect(await readFile(file.path, "utf8")).toBe(text)
})

test("respects the client's XDG configuration directory", () => {
  expect(configPath({ XDG_CONFIG_HOME: "/custom/config" })).toBe("/custom/config/opencode/cli.json")
  expect(configPath({ XDG_CONFIG_HOME: "" })).toBe(configPath({}))
})
