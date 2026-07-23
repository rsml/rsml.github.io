#!/usr/bin/env node
/**
 * Purges the Cloudflare edge cache for rossmiller.dev.
 *
 * Why this is needed: the site is static and fronted by Cloudflare, which
 * caches assets for hours or days. A deploy therefore does not become visible
 * at the edge until the TTL lapses. That is mostly invisible for page HTML,
 * which has a short TTL, but it bites hard on long-lived files. The social
 * cards are the worst case, because LinkedIn and X scrape a card once and then
 * cache it on their side, so a stale edge copy gets frozen into their caches
 * too and outlives the purge.
 *
 * Usage:
 *   pnpm purge              purge everything
 *   pnpm purge /og.png /a   purge specific paths
 *
 * The token comes from CLOUDFLARE_CACHE_TOKEN, read from the environment or
 * from .env in the repo root. It is scoped to Cache Purge on this zone only,
 * so it cannot change DNS, edit Pages projects, or touch any other domain on
 * the account. CI reads the same name from repo secrets.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The rossmiller.dev zone. Safe to hardcode: it is an identifier, not a secret,
// and pinning it means a mis-set token can never purge a different domain.
const ZONE_ID = '6805cb853e2228bf92a3c7dded8e6b73';
const ZONE_NAME = 'rossmiller.dev';
const API = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`;

/** Reads .env without a dependency. Real env vars win over the file. */
function loadEnv() {
  const path = join(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  loadEnv();
  const token = process.env.CLOUDFLARE_CACHE_TOKEN;
  if (!token) {
    console.error(
      'CLOUDFLARE_CACHE_TOKEN is not set.\n'
      + 'Add it to .env in the repo root (gitignored), or export it.',
    );
    process.exit(1);
  }

  const paths = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const body = paths.length
    ? { files: paths.map((p) => new URL(p, `https://${ZONE_NAME}`).toString()) }
    : { purge_everything: true };

  console.log(
    paths.length
      ? `Purging ${paths.length} file(s) from ${ZONE_NAME}:\n  ${body.files.join('\n  ')}`
      : `Purging everything from ${ZONE_NAME}`,
  );

  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.success) {
    console.error('Purge failed.');
    for (const e of json.errors ?? []) console.error(`  ${e.code}: ${e.message}`);
    if (!json.errors?.length) console.error(`  HTTP ${res.status}`);
    process.exit(1);
  }
  console.log('Purged. The edge will refetch from origin on the next request.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
