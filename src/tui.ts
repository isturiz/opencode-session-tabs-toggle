import type { Plugin } from "@opencode/plugin/tui"
import { configPath, toggleTabs, type VisibleMode } from "./config"

export default {
  id: "opencode-session-tabs-toggle",
  setup(context) {
    const keybind = context.options.keybind ?? "<leader>v"
    if (keybind !== false && (typeof keybind !== "string" || !keybind.trim())) {
      throw new Error("opencode-session-tabs-toggle keybind must be a nonempty string or false")
    }
    const [state, updateState] = context.storage.store("visible-mode", {
      initial: { mode: "auto" as VisibleMode },
    })
    let pending = Promise.resolve()
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "session-tabs-toggle.toggle",
        title: "Toggle session tabs",
        description: "Show or hide the session tab column/strip",
        group: "Sessions",
        bind: keybind,
        palette: true,
        slash: { name: "toggle-tabs" },
        run() {
          // Serialize repeated key presses, including the durable previous-mode update.
          pending = pending.then(async () => {
            await toggleTabs({
              path: configPath(),
              inlineConfig: process.env.OPENCODE_CLI_CONFIG_CONTENT,
              previousMode: state.mode === "on" ? "on" : "auto",
              remember: (mode) => updateState((draft) => { draft.mode = mode }),
            })
          }).catch((error: unknown) => {
            context.ui.toast.show({
              title: "Session tabs",
              message: error instanceof Error ? error.message : String(error),
              variant: "error",
            })
          })
          return pending
        },
      }],
      bindings: ["session-tabs-toggle.toggle"],
    }))
  },
} satisfies Plugin.Definition
