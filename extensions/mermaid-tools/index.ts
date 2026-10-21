/**
 * mermaid-tools — registers the three Mermaid authoring tools into the current
 * pi session:
 *
 *   write_mermaid / edit_mermaid / render_mermaid
 *
 * They live in ./tools/mermaid_tools.ts and share one pid-scoped source file;
 * render_mermaid shells out to the bundled @mermaid-js/mermaid-cli and returns
 * the PNG inline, publishing it into <cwd>/viz when given `save_as`.
 *
 * ── Subagent support (optional) ─────────────────────────────────────────────
 * If the `interactive-subagents` extension is installed, it exposes
 * `registerToolExtension` on `globalThis.__pi_interactive_subagents`. A child
 * subagent is launched with `--no-extensions` plus an explicit `-e <path>` for
 * tools whose name → path mapping it knows, so we teach it these three names.
 * That lets an agent definition (see `agents/mermaid-maker.md`) that lists
 * `write_mermaid, edit_mermaid, render_mermaid` get the tools in its child
 * process. Registration is deferred to `session_start` because pi loads
 * project/package extensions before global ones, and it is idempotent, so
 * `/reload` is harmless.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import mermaidToolsExtension from "./tools/mermaid_tools.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_FILE = path.join(HERE, "tools", "mermaid_tools.ts")

interface InteractiveSubagentsApi {
  registerToolExtension?: (name: string, extensionPath: string) => void
}

function registerWithSubagents(): void {
  const api = (globalThis as { __pi_interactive_subagents?: InteractiveSubagentsApi }).__pi_interactive_subagents
  if (!api?.registerToolExtension) return // interactive-subagents not installed — nothing to do
  if (!fs.existsSync(TOOLS_FILE)) return
  for (const name of ["write_mermaid", "edit_mermaid", "render_mermaid"]) {
    try {
      api.registerToolExtension(name, TOOLS_FILE)
    } catch {
      // Already registered (same name+path is a no-op) — ignore.
    }
  }
}

export default function mermaidTools(pi: ExtensionAPI) {
  // Direct registration: the tools work in this session with no subagent setup.
  mermaidToolsExtension(pi)

  // Optional: also expose them to subagent child processes.
  pi.on("session_start", async () => {
    registerWithSubagents()
  })
}
