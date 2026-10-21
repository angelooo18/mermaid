#!/usr/bin/env node
/**
 * Smoke test for the mermaid tools. Runs the three tools directly (no model in
 * the loop) in a throwaway cwd, and checks that source writing, exact-match
 * editing, preview rendering, publishing, and the error paths all behave.
 *
 *   npm run smoke
 *
 * Exits non-zero on the first failed check.
 */

import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const workdir = mkdtempSync(join(tmpdir(), "mermaid-smoke-"))
process.chdir(workdir)

const { default: extension } = await import("../extensions/mermaid-tools/tools/mermaid_tools.ts")

const tools = {}
extension({ registerTool: (t) => (tools[t.name] = t), on: () => {} })

let failures = 0
function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`)
  if (!ok) failures++
}

for (const name of ["write_mermaid", "edit_mermaid", "render_mermaid"]) {
  check(`registered ${name}`, typeof tools[name]?.execute === "function")
}

const source = ["graph TD", "  A[axiom] --> B[derived fact]", "  A --> C[lemma]", "  B --> D[theorem]", "  C --> D", ""].join("\n")

const write = await tools.write_mermaid.execute("1", { source })
check("write_mermaid reports lines", write.details?.lines === 5, String(write.details?.lines))

const edit = await tools.edit_mermaid.execute("2", { old_text: "B[derived fact]", new_text: "B[derived]" })
check("edit_mermaid applies", edit.content[0].text.includes("B[derived]"))

try {
  await tools.edit_mermaid.execute("3", { old_text: "not-in-source", new_text: "x" })
  check("edit_mermaid rejects a miss", false)
} catch (error) {
  check("edit_mermaid rejects a miss", /not found/.test(error.message))
}

try {
  await tools.edit_mermaid.execute("4", { old_text: "-->", new_text: "==>" })
  check("edit_mermaid rejects an ambiguous match", false)
} catch (error) {
  check("edit_mermaid rejects an ambiguous match", /appears \d+ times/.test(error.message))
}

const preview = await tools.render_mermaid.execute("5", {})
check("render_mermaid returns an image", preview.content.some((c) => c.type === "image"))
check("render_mermaid preview does not publish", readdirSafe("viz").length === 0)

const published = await tools.render_mermaid.execute("6", { save_as: "Dependency Graph!", theme: "neutral" })
const files = readdirSafe("viz")
check("render_mermaid publishes into viz/", files.length === 1, files[0])
check("published filename is slugified", /^viz-dependency-graph-\d+\.png$/.test(files[0] ?? ""))
check("publish returns filename+path", Boolean(published.details?.filename && published.details?.path))

const svg = await tools.render_mermaid.execute("7", { save_as: "vector", format: "svg" })
check("svg publishes a .svg file", readdirSafe("viz").some((f) => /^viz-vector-\d+\.svg$/.test(f)))
check("svg still returns a raster preview", svg.content.some((c) => c.type === "image" && c.mimeType === "image/png"))

const jpg = await tools.render_mermaid.execute("8", { save_as: "photo", format: "jpg" })
check("jpg publishes a .jpg file", readdirSafe("viz").some((f) => /^viz-photo-\d+\.jpg$/.test(f)))
check("jpg returns image/jpeg", jpg.content.some((c) => c.type === "image" && c.mimeType === "image/jpeg"))

try {
  await tools.render_mermaid.execute("9", { format: "gif" })
  check("render_mermaid rejects an unknown format", false)
} catch (error) {
  check("render_mermaid rejects an unknown format", /unknown format/.test(error.message))
}

function readdirSafe(dir) {
  try {
    return readdirSync(join(workdir, dir))
  } catch {
    return []
  }
}

console.log(failures === 0 ? `\nAll checks passed. Output: ${join(workdir, "viz")}` : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
