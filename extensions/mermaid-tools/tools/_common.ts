/**
 * Shared helpers for the mermaid authoring loop:
 *
 *   • run()          — subprocess runner with timeout + PATH augmentation
 *   • session dir    — one managed source dir per pi process (pid-keyed)
 *   • applyEdit()    — exact-match single replacement (pi-edit semantics)
 *   • snippetAround()— a small numbered window around an edit, for feedback
 *   • publish()      — copy a render into <cwd>/viz with a unique filename
 *   • findChrome()   — locate a usable Chrome/Chromium for mermaid-cli
 *
 * Transient render files live in the OS temp dir; only a published PNG ever
 * lands in the user's project.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, accessSync, constants } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

// pi may be launched with a thin PATH (tmux, GUI, subagent child). Augment it
// so derived binaries (mmdc, and the browser it spawns) still resolve.
export const EXTRA_PATH = [
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/snap/bin",
  "/opt/homebrew/bin",
  "/opt/local/bin",
  join(homedir(), ".local", "bin"),
  join(homedir(), ".bun", "bin"),
  join(homedir(), ".npm-global", "bin"),
]

// Staging lives in the OS temp dir, never in the user's project.
export const STAGING_ROOT = join(tmpdir(), "pi-mermaid-tools")

/** Directory published diagrams go to, relative to the project root. */
export function publishDirName(): string {
  return process.env.PI_MERMAID_DIR?.trim() || "viz"
}

const MAC_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]

const LINUX_CHROME_PATHS = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/usr/bin/brave-browser",
  "/usr/bin/microsoft-edge",
]

const CHROME_BIN_NAMES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "microsoft-edge",
]

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function whichSync(name: string): string | undefined {
  for (const dir of [...EXTRA_PATH, ...(process.env.PATH ?? "").split(":")]) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

/** Chrome downloaded by puppeteer (`npx puppeteer browsers install chrome`). */
function findPuppeteerChrome(): string | undefined {
  const roots = [
    process.env.PUPPETEER_CACHE_DIR,
    join(homedir(), ".cache", "puppeteer", "chrome"),
    join(homedir(), "Library", "Caches", "puppeteer", "chrome"),
    join(homedir(), "AppData", "Local", "puppeteer", "chrome"),
  ].filter((r): r is string => Boolean(r))

  const relPaths = [
    join("chrome-linux64", "chrome"),
    join("chrome-linux", "chrome"),
    join("chrome-win64", "chrome.exe"),
    join("chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    join("chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
  ]

  for (const root of roots) {
    if (!existsSync(root)) continue
    let versions: string[]
    try {
      versions = readdirSync(root).sort().reverse()
    } catch {
      continue
    }
    for (const version of versions) {
      for (const rel of relPaths) {
        const p = join(root, version, rel)
        if (isExecutable(p)) return p
      }
    }
  }
  return undefined
}

/**
 * Locate the `mmdc` binary: walk up from the extension dir looking for a
 * `node_modules/.bin/mmdc` (the package root may be several levels up), then
 * fall back to PATH.
 */
export function findMmdc(startDir: string): string | undefined {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "node_modules", ".bin", "mmdc")
    if (isExecutable(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return whichSync("mmdc")
}

/** The nearest directory above `startDir` that has a package.json. */
export function findPackageRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

/**
 * Find a browser for mermaid-cli. Order: explicit env override → known install
 * paths → PATH lookup → puppeteer's managed download. Returns undefined when
 * nothing is found, in which case mermaid-cli falls back to whatever puppeteer
 * resolves on its own (and reports a clear error if that also fails).
 */
export function findChrome(): string | undefined {
  for (const fromEnv of [process.env.PI_MERMAID_CHROME, process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH]) {
    const v = fromEnv?.trim()
    if (v && existsSync(v)) return v
  }
  for (const p of [...LINUX_CHROME_PATHS, ...MAC_CHROME_PATHS]) if (isExecutable(p)) return p
  for (const name of CHROME_BIN_NAMES) {
    const p = whichSync(name)
    if (p) return p
  }
  return findPuppeteerChrome()
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const augmentedPath = [...EXTRA_PATH, process.env.PATH ?? ""].join(":")
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}), PATH: augmentedPath },
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, opts.timeoutMs)
    child.stdout.on("data", (d) => (stdout += d.toString()))
    child.stderr.on("data", (d) => (stderr += d.toString()))
    child.on("error", (err) => {
      clearTimeout(timer)
      resolveRun({ code: null, stdout, stderr: stderr + String(err), timedOut })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr, timedOut })
    })
  })
}

/** One managed source dir per pi process, so parallel makers never collide. */
export function sessionDir(group: string): string {
  return join(STAGING_ROOT, `${group}-${process.pid}`)
}

export interface Session {
  workDir: string
  bodyPath: string
}

/** Write the full source to the managed file, creating the session work dir. */
export function writeBody(group: string, bodyFileName: string, source: string): Session {
  const workDir = sessionDir(group)
  mkdirSync(workDir, { recursive: true })
  const bodyPath = join(workDir, bodyFileName)
  writeFileSync(bodyPath, source, "utf8")
  return { workDir, bodyPath }
}

/** Re-attach to a source written before an extension reload, if one exists. */
export function recoverSession(group: string, bodyFileName: string): Session | null {
  const workDir = sessionDir(group)
  const bodyPath = join(workDir, bodyFileName)
  return existsSync(bodyPath) ? { workDir, bodyPath } : null
}

/**
 * Exact-match single replacement on the current source, matching pi's built-in
 * edit: old_text must appear exactly once. Returns the updated content and the
 * match offset, or throws a precise error.
 */
export function applyEdit(current: string, oldText: string, newText: string): { updated: string; index: number } {
  if (oldText === "") throw new Error("`old_text` must be non-empty.")
  if (oldText === newText) throw new Error("`old_text` and `new_text` are identical.")
  const first = current.indexOf(oldText)
  if (first === -1) {
    throw new Error("`old_text` not found in the current source — match it exactly (whitespace included).")
  }
  const second = current.indexOf(oldText, first + 1)
  if (second !== -1) {
    let n = 0
    let i = current.indexOf(oldText)
    while (i !== -1) {
      n++
      i = current.indexOf(oldText, i + oldText.length)
    }
    throw new Error(`\`old_text\` appears ${n} times — add surrounding context to make it unique.`)
  }
  const updated = current.slice(0, first) + newText + current.slice(first + oldText.length)
  return { updated, index: first }
}

/** A small numbered window of `content` around char offset `index`. */
export function snippetAround(content: string, index: number, contextLines = 3): string {
  const before = content.slice(0, index)
  const hitLine = before.split("\n").length - 1
  const lines = content.split("\n")
  const start = Math.max(0, hitLine - contextLines)
  const end = Math.min(lines.length - 1, hitLine + contextLines)
  const width = String(end + 1).length
  const out: string[] = []
  for (let i = start; i <= end; i++) out.push(`${String(i + 1).padStart(width)}  ${lines[i]}`)
  return out.join("\n")
}

function slugify(slug: string): string {
  return (
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "viz"
  )
}

/** Copy a rendered PNG into <cwd>/<publishDir> with a unique, slugified name. */
export function publish(pngPath: string, slug: string): { filename: string; path: string } {
  const filesDir = join(process.cwd(), publishDirName())
  mkdirSync(filesDir, { recursive: true })
  const filename = `viz-${slugify(slug)}-${Date.now()}.png`
  const dest = join(filesDir, filename)
  copyFileSync(pngPath, dest)
  return { filename, path: dest }
}

export { basename, dirname, join, existsSync, mkdirSync, readFileSync, writeFileSync }
