---
name: mermaid
description: Author a correct, minimal Mermaid diagram as a PNG — dependency graphs, flows, sequences, state machines, trees, ER/class diagrams, timelines. Use when an idea is genuinely clearer as a picture than as prose, and you want to verify the diagram by looking at it before shipping it.
---

# Mermaid diagrams

Three tools, one managed source file per session. You never name the file.

| Tool | Does |
|---|---|
| `write_mermaid({ source })` | Replaces the whole source (first draft, or a full rewrite) |
| `edit_mermaid({ old_text, new_text })` | One exact-match replacement; fails loudly on 0 or >1 matches |
| `render_mermaid({ save_as?, format?, theme?, background? })` | Renders the source, returns the picture **inline**; with `save_as`, also publishes to `<cwd>/viz` |

## The loop that matters

1. **Decide the one idea, then cut.** A diagram that needs more than ~7 nodes is usually two diagrams or none. For every node ask: *if I delete this, is the idea still clear?* If yes, delete it.
2. **`write_mermaid`** with the complete source. Pick the type that fits the claim, not the one that looks impressive:
   - `graph TD` / `graph LR` — dependencies, flows, hierarchy (`TD` for foundations-at-top)
   - `sequenceDiagram` — messages between parties over time
   - `stateDiagram-v2` — modes and transitions
   - `erDiagram`, `classDiagram` — data shapes and relations
   - `mindmap`, `timeline` — decomposition, chronology
3. **`render_mermaid`** with no `save_as` — this is a preview.
4. **Look at the returned image.** Rendering success only proves the syntax parsed; it says nothing about whether the picture is *true* or readable. Check: every arrow direction, every label, no overlap or clipping, nothing cramped.
5. **`edit_mermaid`** and re-render. A few passes is normal. When the fix is "too much happening", the fix is fewer elements, not smaller text.
6. **Publish** once it is correct and clean: `render_mermaid({ save_as: "short-kebab-topic" })` → writes `viz/viz-<slug>-<timestamp>.png`.

## Formats

| `format` | File | Use for |
|---|---|---|
| `png` (default) | `viz-<slug>-<ts>.png` | Screenshots, Obsidian/Notion embeds, anywhere a raster is fine |
| `svg` | `viz-<slug>-<ts>.svg` | Docs, slides, READMEs — vector stays sharp at any zoom, editable in Figma/Inkscape, themeable via CSS |
| `jpg` | `viz-<slug>-<ts>.jpg` | Smaller files for slide decks and chat; **no transparency** (image is flattened onto `background`) |

`svg` and `jpg` renders still come back as an inline PNG/JPEG **preview**, so the look-then-fix loop works the same for every format. Omitting `format` keeps `png`, so existing calls don't change.

## Rules

- **Never ship a diagram you haven't looked at.** If you're unsure whether an edge is true, omit it — a smaller true diagram beats a complete false one.
- **Keep labels short.** A node holds a term or short phrase. Sentences wreck the layout.
- **Don't invent content.** Draw only what the idea specifies; if the brief is thin, draw the smaller true thing.
- **One PNG, one idea.** For a second idea, publish a second diagram.
- If the picture needs exact coordinates, geometry, or plots, Mermaid is the wrong tool — hand-written SVG is.

## Embedding

The published filename is meant to be embedded next to the prose that introduces it (Obsidian: `![[viz-<slug>-<timestamp>.png|500]]`; plain Markdown: `![](viz/viz-<slug>-<timestamp>.png)`). Introduce the visual in one sentence, then let it carry the idea — don't narrate every element back in prose.
