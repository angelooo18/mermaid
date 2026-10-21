/**
 * The mermaid authoring loop — three tools that share one session source file:
 *
 *   write_mermaid  — write the full Mermaid source to the session's file
 *   edit_mermaid   — exact-match old_text→new_text on that file (pi-edit semantics)
 *   render_mermaid — render whatever is in the file → PNG, returned inline;
 *                    with `save_as`, also publish it into <cwd>/viz
 *
 * Rendering shells out to @mermaid-js/mermaid-cli (`mmdc`) with a puppeteer
 * config pointing at a discovered Chrome when one exists — otherwise mmdc uses
 * puppeteer's own managed browser. Session state is module-level and pid-keyed,
 * so parallel pi processes never share a diagram file.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { fileURLToPath } from "node:url"
import {
  applyEdit,
  dirname,
  existsSync,
  findChrome,
  findMmdc,
  findPackageRoot,
  join,
  mkdirSync,
  publish,
  readFileSync,
  recoverSession,
  run,
  type Session,
  snippetAround,
  writeBody,
  writeFileSync,
} from "./_common.ts"

const TOOL_DIR = dirname(fileURLToPath(import.meta.url))
const MMDC_BIN = findMmdc(TOOL_DIR)
const PACKAGE_ROOT = findPackageRoot(TOOL_DIR)
const GROUP = "mermaid"
const BODY_FILE = "diagram.mmd"
const RENDER_TIMEOUT_MS = 120_000

const THEMES = ["default", "neutral", "dark", "forest", "base"] as const

type RenderDetails = { ok: boolean; path: string; filename?: string }

let session: Session | null = null

function currentSession(): Session | null {
  if (session && existsSync(session.bodyPath)) return session
  session = recoverSession(GROUP, BODY_FILE)
  return session
}

function requireSession(tool: string): Session {
  const s = currentSession()
  if (!s) throw new Error(`${tool}: no Mermaid source yet — call write_mermaid first.`)
  return s
}

export default function mermaidToolsExtension(pi: ExtensionAPI) {
  // ── write_mermaid ──────────────────────────────────────────────────────────
  pi.registerTool({
    name: "write_mermaid",
    label: "Write Mermaid",
    description:
      "Write the FULL Mermaid source to this session's managed diagram file (first draft or a " +
      "complete rewrite). You do NOT name the file — edit_mermaid and render_mermaid act on the " +
      "same one.\n\n" +
      "`source` is a complete Mermaid diagram: `graph TD` / `graph LR` (flows, dependency graphs), " +
      "`sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`, `mindmap`, `timeline`, " +
      "or `block-beta`. Writing does NOT render — call render_mermaid when ready. For a small fix, " +
      "prefer edit_mermaid over rewriting.",
    parameters: Type.Object({
      source: Type.String({
        description: "The complete Mermaid source. Starts with the diagram type, e.g. `graph TD`.",
      }),
    }),
    async execute(_id, params) {
      const source = String(params.source ?? "").trim()
      if (!source) throw new Error("`write_mermaid` requires a non-empty `source`.")
      session = writeBody(GROUP, BODY_FILE, source)
      const lines = source.split("\n").length
      return {
        content: [
          {
            type: "text",
            text: `Wrote ${lines}-line Mermaid source.\nCall render_mermaid to render it, or edit_mermaid to tweak it.`,
          },
        ],
        details: { ok: true, path: session.bodyPath, lines },
      }
    },
  })

  // ── edit_mermaid ───────────────────────────────────────────────────────────
  pi.registerTool({
    name: "edit_mermaid",
    label: "Edit Mermaid",
    description:
      "Make a single exact-match replacement in this session's Mermaid source — the same contract " +
      "as pi's built-in edit, locked to the one managed file. `old_text` must appear EXACTLY ONCE " +
      "(include surrounding context for uniqueness); on 0 or >1 matches the call fails and nothing " +
      "changes. Editing does NOT render.",
    parameters: Type.Object({
      old_text: Type.String({ description: "Exact substring of the current source to replace (must match once)." }),
      new_text: Type.String({ description: "Replacement text for `old_text`." }),
    }),
    async execute(_id, params) {
      const { bodyPath } = requireSession("edit_mermaid")
      const current = readFileSync(bodyPath, "utf8")
      const { updated, index } = applyEdit(current, String(params.old_text ?? ""), String(params.new_text ?? ""))
      writeFileSync(bodyPath, updated, "utf8")
      return {
        content: [
          {
            type: "text",
            text: "Applied edit. Updated region:\n```\n" + snippetAround(updated, index) + "\n```\nCall render_mermaid to see it.",
          },
        ],
        details: { ok: true, path: bodyPath },
      }
    },
  })

  // ── render_mermaid ─────────────────────────────────────────────────────────
  pi.registerTool({
    name: "render_mermaid",
    label: "Render Mermaid",
    description:
      "Render the CURRENT session Mermaid source to a PNG and return it inline so you can SEE the " +
      "diagram and iterate. You do NOT pass the source here — it comes from the managed file; call " +
      "write_mermaid first.\n\n" +
      "Iterate freely with no `save_as` (preview only). When the diagram is correct and clean, call " +
      "once more with `save_as` set to a short kebab-case topic slug: that publishes the PNG into " +
      "<cwd>/viz with a unique filename and returns the filename to embed. On a render error this " +
      "returns the error text instead of an image — fix with edit_mermaid and re-render.",
    parameters: Type.Object({
      save_as: Type.Optional(
        Type.String({
          description:
            "Short kebab-case topic slug (e.g. 'internet-packets'). When set, the rendered PNG is " +
            "published to <cwd>/viz as viz-<slug>-<timestamp>.png and the filename is returned. " +
            "Omit for a preview-only render.",
        }),
      ),
      theme: Type.Optional(
        Type.String({
          description: `Mermaid theme: ${THEMES.join(" | ")}. Defaults to mmdc's default; \`neutral\` reads well on light slides.`,
        }),
      ),
      background: Type.Optional(
        Type.String({ description: "PNG background color, e.g. 'white' (default), 'transparent', '#f5f5f5'." }),
      ),
    }),
    async execute(_id, params) {
      const { workDir, bodyPath } = requireSession("render_mermaid")
      mkdirSync(workDir, { recursive: true })

      if (!MMDC_BIN) {
        throw new Error(
          `render_mermaid: mermaid-cli (mmdc) not found. Run \`npm install\` in ${PACKAGE_ROOT} (it installs @mermaid-js/mermaid-cli).`,
        )
      }

      const chrome = findChrome()
      const cfgPath = join(workDir, "puppeteer.json")
      writeFileSync(
        cfgPath,
        JSON.stringify(
          chrome
            ? { executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage"] }
            : { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
          null,
          2,
        ),
        "utf8",
      )

      const outPath = join(workDir, `render-${Date.now()}.png`)
      const args = ["-i", bodyPath, "-o", outPath, "-p", cfgPath, "-s", "2"]
      args.push("-b", String(params.background ?? "white"))
      if (params.theme) args.push("-t", String(params.theme))

      const res = await run(MMDC_BIN, args, {
        cwd: workDir,
        timeoutMs: RENDER_TIMEOUT_MS,
        env: chrome ? { PUPPETEER_SKIP_DOWNLOAD: "1" } : {},
      })

      if (res.code !== 0 || !existsSync(outPath)) {
        const detail = (res.stderr || res.stdout || "unknown error").split("\n").slice(-30).join("\n")
        const note = res.timedOut ? "mmdc timed out.\n\n" : ""
        return {
          content: [
            {
              type: "text",
              text: `${note}Mermaid render FAILED — no image produced. Fix the source with edit_mermaid and call render_mermaid again.\n\nError:\n${detail}`,
            },
          ],
          details: { ok: false, path: "" } as RenderDetails,
        }
      }

      const data = readFileSync(outPath).toString("base64")
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = []

      if (params.save_as) {
        const { filename, path } = publish(outPath, String(params.save_as))
        content.push({
          type: "text",
          text: `Published.\nfilename: ${filename}\npath: ${path}\n\nLOOK at the diagram below to confirm it is correct before returning it.`,
        })
        content.push({ type: "image", data, mimeType: "image/png" })
        return { content, details: { ok: true, path, filename } as RenderDetails }
      }

      content.push({
        type: "text",
        text: "Preview render (not saved). LOOK: are arrows/relationships correct, labels right, nothing cramped? Fix with edit_mermaid, or re-render with `save_as` to publish.",
      })
      content.push({ type: "image", data, mimeType: "image/png" })
      return { content, details: { ok: true, path: outPath } as RenderDetails }
    },
  })
}
