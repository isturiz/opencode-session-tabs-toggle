import { expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import plugin from "../tui"

test("exposes the TUI entrypoint for directory-based installation", () => {
  const directory = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
  expect(Bun.resolveSync(join(directory, "tui"), directory)).toBe(join(directory, "tui.ts"))
})

test("exports the plugin definition without importing the host SDK at runtime", () => {
  expect(plugin.id).toBe("opencode-session-tabs-toggle")
  expect(typeof plugin.setup).toBe("function")
})
