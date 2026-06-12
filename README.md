# rsml.github.io

Ross Miller's portfolio. An [Astro](https://astro.build) static site, deployed to GitHub Pages on push to `master`.

Watch the talk: [Books That Learn How You Learn](https://www.youtube.com/watch?v=XIXhGluiswI). A demo of the [Tutor](tutor/) app and why it was built.

## Develop

```sh
make          # one-time: points git at .githooks
pnpm install
pnpm dev      # http://localhost:4321
```

Other scripts: `pnpm build` (static build to `dist/`), `pnpm check` (type + diagnostics), `pnpm test` (Vitest).

## Editing content

Every project's title, subtitle, role, links, and gallery assets live in **`src/data/work.yaml`**, the single source of truth. To add, reorder, or edit a project, edit that one file. The order of projects in the file is the order on the home page. Its header comment documents every field and the four gallery asset types (image, gif, video, embed).

See [`CLAUDE.md`](CLAUDE.md) for the full content-editing guide and architecture notes (it is also what AI coding agents read).
