# Local work.yaml editor: design

Date: 2026-06-10
Status: approved

## Goal

A dev-only visual editor for the homepage content in `src/data/work.yaml`:
drag-reorder projects, images, and links; drop image files to add them; edit
the short text fields; add an optional per-project date. It must never affect
the production site's performance or payload in any way.

## Decisions made

- Custom minimal tool, not an existing CMS. Decap/Sveltia were evaluated and
  rejected: they re-serialize the YAML (destroying the header documentation
  comment and inline TODO/NOTE comments), churn formatting, and assume a
  central media folder rather than this repo's per-project `public/` folders.
  Open source is used as libraries instead: SortableJS (drag and drop) and
  the `yaml` package (comment-preserving document round-trip).
- Editable text fields: cardTitle, title, role, subtitle, date, cardDesc,
  blurb ("all short text fields").
- New optional `date` field, displayed on the homepage (see below).
- Explicit Save (not autosave).

## Architecture

```
tools/editor/
  server.ts        I/O adapter: HTTP server (node:http), file reads/writes
  apply-edits.ts   PURE: (yamlText, editedProjects) -> newYamlText
  apply-edits.test.ts
  public/          editor UI: index.html + client JS/CSS (static, no build)
src/data/
  schema.ts        PURE: the Zod schema + inferred types (extracted from work.ts)
  work.ts          loader: ?raw import + parse + youtube helpers (unchanged API)
```

- `pnpm edit` runs `node tools/editor/server.ts` (Node >= 23.6 strips types
  natively; this machine runs Node 24). Server binds 127.0.0.1 on port 4399.
- Nothing in `src/` imports anything from `tools/`. New deps `yaml` and
  `sortablejs` are devDependencies. The production build output contains zero
  editor code; `pnpm build` output is unchanged by the editor's existence.
  The site changes only when the edited `work.yaml` is committed, identical
  to hand-editing. (The `date` display below is a separate, deliberate
  production change.)
- If `pnpm dev` runs in another tab, each save hot-reloads the real homepage
  (Vite watches `work.yaml?raw`), giving live preview for free.

### HTTP surface

- `GET /` editor page (and its static JS/CSS; SortableJS served from
  node_modules via an explicit route).
- `GET /api/work` parsed projects as JSON, each project/link/asset stamped
  with a stable `_id` (project: slug; links/assets: original index) used to
  match nodes on save.
- `POST /api/save` edited projects JSON. Server applies edits to the YAML
  document, validates with the Zod schema BEFORE writing, then writes
  `work.yaml`. Invalid data returns the precise Zod error to the UI and
  writes nothing.
- `POST /api/upload?slug=...&name=...` raw image bytes. Written into the
  project's asset folder under `public/` (inferred as the common directory of
  its existing assets' `src`, fallback `public/<slug>/`), filename collisions
  get a numeric suffix. Returns the new `src` path.
- Any other `GET` is served from `public/` so existing thumbnails render with
  their real `src` values.

### Comment-preserving saves (the core)

`apply-edits.ts` uses the `yaml` package's Document API and never regenerates
the file from scratch:

- Parse the existing file to a Document. The header comment block and every
  inline comment live on nodes.
- Projects are matched by slug, links/assets by the `_id` stamped at load.
  Matched items REUSE their existing YAML nodes: reordering rearranges the
  node list (comments ride along), field edits use `map.set` on the existing
  map (the key node and its comments survive), new items are `createNode`'d,
  removed items drop out.
- Stringify with options matching the file style (2-space indent, no line
  rewrapping). Untouched scalars keep their original quoting style because
  node style metadata is preserved.

This function is pure ((yamlText, editedProjects) -> newYamlText) and unit
tested in Vitest: header comment preserved, inline comments (chord-colors
NOTE, App Store TODOs) ride with their items through reorders, field edits,
add/remove, and date round-trips.

### Schema extraction

The Zod schema moves from `work.ts` to a new pure `src/data/schema.ts` (no
`?raw`, no I/O). `work.ts` imports it, re-exports the schema's types, and
keeps its existing exports (`WORK`, `getWork`, `getProject`, youtube helpers),
so its public API is unchanged and no consumer changes.
The editor server imports the same `schema.ts`, so there is exactly one
definition of a project's shape and saves are validated against the real
schema. `work.test.ts` must stay green.

## Editor UI

One page, a vertical list of project cards in homepage order:

- Drag handle per card to reorder projects.
- Text inputs per card: cardTitle, title, role, subtitle, date, cardDesc,
  blurb.
- Links: rows of label + href with drag-reorder, add, delete.
- Images: horizontal thumbnail strip. Drag to reorder; per-thumb alt input
  and delete. Drop image files (png/jpg/jpeg/webp/gif) onto the strip to add:
  file copied into the project's asset folder, asset entry appended with the
  project's prevailing orientation (fallback by device: iphone -> portrait,
  desktop/ipad -> landscape) and an empty alt, visually flagged until filled.
  A dropped `.gif` gets `type: gif`. Existing video/youtube/embed assets show
  a type badge and can be reordered, alt-edited, and deleted, but adding them
  stays hand-edit-in-YAML.
- Explicit Save button + Cmd+S, dirty indicator, beforeunload warning.
  Validation errors from the server render inline.

## Production-facing change: date display

- Schema: `date: z.string().optional()`, a freeform string so ranges work
  ("2024", "2019-2021", "2018-present").
- `WorkRow.astro`: when set, the date is appended to the role eyebrow with a
  middot separator in the same muted style: "Creator · 2018-present". No date
  set renders exactly today's markup, so all rows are unaffected until dates
  are filled in.

## Error handling

- Save: Zod validation failure -> 400 with the error message, file untouched.
- Upload: non-image MIME/extension rejected with a clear message (videos and
  embeds are added by hand in YAML).
- Server-side write failures surface in the UI; the file is written in a
  single `writeFile` (small file, atomicity is not a practical concern, and
  git is the safety net).
- The UI is localhost-only and single-user; no auth, no concurrency control.

## Testing

- Vitest unit tests for `apply-edits.ts` (the only intricate logic): comment
  preservation, reorders at all three levels, add/remove/edit, new `date`
  field round-trip.
- `work.test.ts` stays green after the schema extraction.
- `pnpm check` and `pnpm build` pass; manual sanity check that `dist/`
  contains no editor code.

## Non-goals

- No editing of slug, device, thumbClass, thumbImage, transition, deepDive,
  marketing fields, appStoreUrl, or ripple config (rare, structural;
  hand-edit the YAML).
- No adding video/youtube/embed assets from the UI.
- No deleting files from `public/` (removing an asset removes only the YAML
  entry).
- No git operations, no auth, no mobile layout for the editor.
