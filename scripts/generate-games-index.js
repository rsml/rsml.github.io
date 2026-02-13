#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const gamesDir = path.join(repoRoot, "games");
const outputFile = path.join(gamesDir, "index.html");

if (!fs.existsSync(gamesDir) || !fs.statSync(gamesDir).isDirectory()) {
  console.error("Expected a games directory at:", gamesDir);
  process.exit(1);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function humanizeName(value) {
  const name = value.replace(/\.html?$/i, "");
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isHtmlFile(fileName) {
  return /\.html?$/i.test(fileName);
}

function pickFolderHtmlEntry(folderPath) {
  const htmlFiles = fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && isHtmlFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  if (htmlFiles.length === 0) {
    return null;
  }

  const indexFile = htmlFiles.find((file) => /^index\.html?$/i.test(file));
  return indexFile || htmlFiles[0];
}

function encodeHref(value) {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

const items = [];
const topLevelEntries = fs
  .readdirSync(gamesDir, { withFileTypes: true })
  .filter((entry) => !entry.name.startsWith("."))
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

for (const entry of topLevelEntries) {
  if (entry.isFile() && isHtmlFile(entry.name) && !/^index\.html?$/i.test(entry.name)) {
    items.push({
      type: "file",
      key: entry.name,
      label: humanizeName(entry.name),
      source: entry.name,
      href: entry.name,
    });
    continue;
  }

  if (entry.isDirectory()) {
    const folderPath = path.join(gamesDir, entry.name);
    const folderHtmlEntry = pickFolderHtmlEntry(folderPath);

    if (!folderHtmlEntry) {
      continue;
    }

    items.push({
      type: "folder",
      key: entry.name,
      label: humanizeName(entry.name),
      source: `${entry.name}/${folderHtmlEntry}`,
      href: `${entry.name}/${folderHtmlEntry}`,
    });
  }
}

const cardsHtml = items
  .map((item) => {
    return [
      `        <a class="game-button" href="./${encodeHref(item.href)}">`,
      `          <span class="game-title">${escapeHtml(item.label)}</span>`,
      `          <span class="game-meta">${escapeHtml(item.source)}</span>`,
      "        </a>",
    ].join("\n");
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Games</title>
    <style>
      :root {
        --background: hsl(210 40% 98%);
        --foreground: hsl(222.2 84% 4.9%);
        --muted-foreground: hsl(215.4 16.3% 46.9%);
        --card: hsl(0 0% 100%);
        --border: hsl(214.3 31.8% 91.4%);
        --ring: hsl(221.2 83.2% 53.3%);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--foreground);
        font-family: "Plus Jakarta Sans", "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 15% 15%, hsl(210 100% 97%), transparent 28rem),
          radial-gradient(circle at 85% 0%, hsl(200 100% 96%), transparent 22rem),
          var(--background);
      }

      main {
        max-width: 980px;
        margin: 0 auto;
        padding: 3.5rem 1rem 4rem;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 5vw, 3rem);
        letter-spacing: -0.02em;
      }

      .subtitle {
        margin: 0.75rem 0 1.5rem;
        color: var(--muted-foreground);
      }

      .pill {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0.3rem 0.65rem;
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--muted-foreground);
        background: color-mix(in hsl, var(--card) 84%, hsl(205 98% 92%));
      }

      .game-grid {
        margin-top: 1.1rem;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 0.8rem;
      }

      .game-button {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        padding: 0.9rem 1rem;
        border: 1px solid var(--border);
        border-radius: 0.75rem;
        text-decoration: none;
        color: var(--foreground);
        background: var(--card);
        box-shadow: 0 1px 2px hsl(222 47% 11% / 0.06);
        transition: transform 140ms ease, box-shadow 180ms ease, border-color 180ms ease,
          background-color 180ms ease;
      }

      .game-button:hover {
        transform: translateY(-2px);
        border-color: hsl(216 82% 64%);
        background: hsl(210 40% 99.5%);
        box-shadow: 0 10px 24px hsl(222 47% 11% / 0.12);
      }

      .game-button:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }

      .game-title {
        font-size: 0.98rem;
        font-weight: 650;
        line-height: 1.3;
      }

      .game-meta {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.73rem;
        color: var(--muted-foreground);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Games</h1>
      <span class="pill">${items.length} game${items.length === 1 ? "" : "s"}</span>
      <section class="game-grid">
${cardsHtml}
      </section>
    </main>
  </body>
</html>
`;

const previousHtml = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : null;

if (previousHtml !== html) {
  fs.writeFileSync(outputFile, html);
  console.log(`Updated games/index.html with ${items.length} game entries.`);
} else {
  console.log("games/index.html is already up to date.");
}
