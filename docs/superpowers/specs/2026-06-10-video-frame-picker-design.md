# Editor video frame picker: design

Date: 2026-06-10
Status: approved

## Goal

In `pnpm editor`, choose the strip/lightbox thumbnail (`poster`) for any
`video` asset by scrubbing the video to an exact frame, including videos that
are already in `work.yaml` (no re-upload; the video file is never touched).
Today a video's poster is generated once at drop time (QuickLook first frame,
capped at 1024 px) and cannot be changed except by hand.

## Decisions made

- Picking style: scrub a modal video player and capture the paused frame.
  (Rejected: client canvas capture, which uploads megabytes and can shift
  colors; a pre-extracted filmstrip grid, which cannot land on an exact
  moment.)
- The client sends only a timestamp; the server extracts the frame with
  ffmpeg at full video resolution.
- Poster file rule: always write `<videobase>-poster.png` next to the video,
  overwriting if present, so re-picking never accumulates files. If the
  asset's current poster is a different path (e.g. a `.webp` produced by
  `pnpm optimize`), repoint the YAML and leave the old file in `public/`
  (same philosophy as asset delete). The next `pnpm optimize` converts the
  new png to webp as usual.
- Drop-time unification: `makePoster`'s video branch (qlmanage + rename
  dance) is replaced by the same ffmpeg extraction at t=0. One mechanism for
  both flows; fresh drops get full-resolution posters too. PDF posters stay
  on sips.

## UI / interaction

- Every `video` thumb in the gallery strip gets a small "frame" button next
  to the existing delete button (it renders for all video assets loaded from
  work.yaml, not just fresh drops).
- Clicking opens a modal overlay: the actual video (`<video controls>`,
  served from `public/` like the thumbs), nudge buttons stepping ±1 frame
  (1/30 s) plus `,` / `.` keyboard shortcuts, a current-time readout, and a
  "Use this frame" button. Esc or ✕ cancels.
- On confirm the client POSTs the timestamp, sets `a.poster` from the
  response, marks the document dirty, and re-renders. The thumbnail is
  cache-busted (`?t=` query) so an overwritten same-name poster shows
  immediately. Saving flows through the existing `/api/save` path
  (`syncAsset` already writes `poster`).

## HTTP surface

- `POST /api/poster?src=<public path>&t=<seconds>`: resolves `src` under
  `public/` with the same traversal guard as static serving; requires the
  file to exist with a `.mp4`/`.webm` extension; requires `t >= 0`. Runs
  `ffmpeg -ss <t> -i <video> -frames:v 1 <dir>/<videobase>-poster.png`
  (input seeking is frame-accurate when decoding; autorotation applies).
  Returns `{ poster: "/<dir>/<videobase>-poster.png" }`. On ffmpeg failure,
  removes any partial output and returns the error; the asset keeps its old
  poster.

## Edge cases

- Timestamp past the end: clamped client-side to `video.duration`; a server
  extract that produces no frame returns an error and changes nothing.
- The endpoint does not require the src to belong to a known project; it
  only requires a real video under `public/` (the editor only offers the
  button on real assets).

## Out of scope

- YouTube posters (auto-derived from the video id), embed/pdf posters,
  uploading a custom image as a poster.

## Testing

- `apply-edits.ts` (the pure, tested core) is untouched; no schema changes.
- The new code is I/O glue in the dev-only server + client, which has no
  test coverage today; verification is manual via `pnpm editor` (pick a
  frame on an existing chord-colors video, save, verify work.yaml and the
  poster file on disk; drop a fresh video and verify its t=0 poster).
- CLAUDE.md's `pnpm editor` description gains a mention of frame picking.
