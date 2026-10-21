# mermaid-tools

Mermaid diagrams as a **verify-by-looking** loop for [pi](https://pi.dev): write the source, render it to a PNG that comes back *inline* so the model can see it, fix what's wrong, then publish.

Extracted from [amosblomqvist/learn](https://github.com/amosblomqvist/learn) (`extensions/visual-tools` → mermaid half) and adapted to work standalone, on Linux, and without the `interactive-subagents` extension.

## What you get

| Piece | Path | What it is |
|---|---|---|
| Extension | `extensions/mermaid-tools/index.ts` | Registers the three tools in your current session — no subagent machinery required |
| Tools | `extensions/mermaid-tools/tools/mermaid_tools.ts` | `write_mermaid`, `edit_mermaid`, `render_mermaid` |
| Skill | `skills/mermaid/SKILL.md` | When to draw, how to brief yourself, the render-and-inspect loop |
| Agent (optional) | `agents/mermaid-maker.md` | A `mermaid-maker` subagent for setups that support it |
| Smoke test | `scripts/smoke.mjs` | `npm run smoke` — exercises all three tools and every output format with no model in the loop |

## The loop

```
write_mermaid({ source })            → source lands in a managed per-session file
render_mermaid({})                   → picture returned inline (preview, nothing saved)
edit_mermaid({ old_text, new_text }) → exact-match fix; fails on 0 or >1 matches
render_mermaid({ save_as: "topic" }) → publishes viz/viz-topic-<timestamp>.png
```

### Formats

`render_mermaid` takes `format: "png" | "svg" | "jpg"` (default `png`):

| format | file | notes |
|---|---|---|
| `png` | `viz-<slug>-<ts>.png` | 2× scale, any background including `transparent` |
| `svg` | `viz-<slug>-<ts>.svg` | vector, editable, sharp at any zoom; the tool still returns a rasterized PNG preview inline so the model can verify it |
| `jpg` | `viz-<slug>-<ts>.jpg` | transcoded from the PNG at quality 92 via [sharp](https://sharp.pixelplumbing.com); no alpha — `transparent` is flattened onto white |

Only svg/png are native `mmdc` outputs; jpg is a sharp transcode, which is why no ImageMagick/rsvg-convert is needed.

The point of the inline image is that **rendering success ≠ correct**. Syntax can parse while an arrow points backwards. The model is expected to look at the returned PNG, catch that, and iterate — the skill and agent definition both enforce it.

`render_mermaid` also takes `theme` (`default|neutral|dark|forest|base`) and `background` (`white` by default, or `transparent`).

## Install

Requires Node ≥ 20, and pi.

```bash
# from GitHub
pi install git:github.com/angelooo18/mermaid

# or try it for one run, without installing
pi -e git:github.com/angelooo18/mermaid

# or from a local clone
git clone https://github.com/angelooo18/mermaid ~/mermaid
pi install ~/mermaid
```

Then in any session: *"draw the dependency graph as a mermaid diagram"* — or invoke the skill directly with `/skill:mermaid`.

### The optional agent

If you use a subagent extension that reads agent definitions from `.pi/agents/` (e.g. `pi-interactive-subagents`), copy it in:

```bash
cp ~/mermaid/agents/mermaid-maker.md <your-project>/.pi/agents/
```

`tools:`, `auto-exit:`, and `system-prompt:` in that file are specific to `pi-interactive-subagents`; adapt them for other implementations. If it's present, the extension also teaches `interactive-subagents` about the three tool names so spawned makers get them.

## Chrome / Chromium

Rendering goes through `@mermaid-js/mermaid-cli` (`mmdc`), which drives a real browser. Discovery order:

1. `PI_MERMAID_CHROME`, `CHROME_PATH`, or `PUPPETEER_EXECUTABLE_PATH`
2. A system install (`google-chrome`, `chromium`, `chromium-browser`, `brave-browser`, `microsoft-edge`, or the macOS app bundles)
3. Puppeteer's managed browser (`~/.cache/puppeteer/chrome/...`)

If nothing is found, `mmdc` falls back to whatever puppeteer resolves itself. To get a managed browser without installing system packages:

```bash
cd ~/mermaid && npx puppeteer browsers install chrome
```

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PI_MERMAID_DIR` | `viz` | Where published files go, relative to the project root |
| `PI_MERMAID_CHROME` | — | Explicit browser binary to use for rendering |

Transient renders live in `$TMPDIR/pi-mermaid-tools/mermaid-<pid>/`, so the only thing that ever appears in your project is a published PNG. The source file is pid-scoped per pi process (parallel makers don't collide) and is picked up again after `/reload`.

## Verify the install

```bash
npm install
npm run smoke
```

Seventeen checks: tools registered, source written, edits applied, ambiguous edits rejected, preview rendered, nothing published on preview, publish slugified and returned, svg/jpg/png outputs produced with correct extensions, unknown formats rejected. Output goes to a throwaway temp dir.

## Credit

Design, tool contracts, and the render-and-inspect philosophy come from [amosblomqvist/learn](https://github.com/amosblomqvist/learn) — a personal learning system shared as-is. This repo is the mermaid half, decoupled from the Obsidian/vault workflow and ported to Linux with standalone registration.
