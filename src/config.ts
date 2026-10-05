import { randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"

export type VisibleMode = "auto" | "on"

export function configPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode", "cli.json")
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseConfig(text: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !object(value)) throw new Error("cli.json must contain a valid JSON object")
  if (value.tabs !== undefined && !object(value.tabs)) throw new Error("cli.json tabs must be an object")
  return value
}

/** Only the CLI file is edited: never the remote server or session database. */
export async function toggleTabs(options: {
  path: string
  previousMode: VisibleMode
  remember: (mode: VisibleMode) => Promise<void>
  inlineConfig?: string
}): Promise<VisibleMode | "off"> {
  if (options.inlineConfig) {
    const inline = parseConfig(options.inlineConfig)
    if (object(inline.tabs) && (inline.tabs.mode !== undefined || inline.tabs.enabled !== undefined)) {
      throw new Error("Remove tabs.mode/tabs.enabled from OPENCODE_CLI_CONFIG_CONTENT to toggle tabs")
    }
  }

  // Resolve an existing symlink before an atomic replacement, preserving the link itself.
  const path = await realpath(options.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return options.path
    throw error
  })
  const original = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  const text = original ?? '{\n  "$schema": "https://opencode.ai/v2/cli.json"\n}\n'
  const config = parseConfig(text)
  const tabs = object(config.tabs) ? config.tabs : {}
  const current = tabs.mode ?? (tabs.enabled === false ? "off" : "auto")
  if (current !== "auto" && current !== "on" && current !== "off") {
    throw new Error("cli.json tabs.mode must be auto, on, or off")
  }
  const next = current === "off" ? options.previousMode : "off"
  if (current !== "off") await options.remember(current)

  const updated = applyEdits(text, modify(text, ["tabs", "mode"], next, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" },
  }))
  await mkdir(dirname(path), { recursive: true })
  const mode = await stat(path).then((file) => file.mode & 0o777).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return 0o600
    throw error
  })
  const temporary = join(dirname(path), `.tabs-toggle-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, updated, { flag: "wx", mode })
    const latest = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (latest !== original) throw new Error("cli.json changed while toggling; please try again")
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
  }
  return next
}
