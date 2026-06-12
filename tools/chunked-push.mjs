#!/usr/bin/env node
/**
 * Push the current branch in small slices, for networks that reset large
 * sustained uploads (a plain `git push` of a few hundred MB of media dies
 * mid-stream with "broken pipe" / "RPC failed" on such connections).
 *
 * How: builds cumulative partial trees of HEAD's content in a TEMP INDEX
 * (the working tree and real index are never touched), commits each slice,
 * and pushes it to a throwaway `push-seed` branch. Each push transfers only
 * one slice of new blobs on a fresh connection, with retries. Once every
 * object is seeded, the real `git push` sends almost nothing, and the seed
 * branch is deleted.
 *
 * Usage:
 *   pnpm push-chunked              # 40 MB slices
 *   pnpm push-chunked --chunk-mb 20
 *
 * Push committed work only: HEAD is what gets seeded and pushed. A single
 * file larger than the slice size still travels in one piece (a git blob
 * cannot be split); if one file exceeds what the network can sustain,
 * shrink the file, there is no transport fix.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chunkArg = process.argv.indexOf('--chunk-mb');
const CHUNK_BYTES = (chunkArg > -1 ? Number(process.argv[chunkArg + 1]) : 40) * 1024 * 1024;
const TEMP_INDEX = path.join(tmpdir(), `chunked-push-index-${process.pid}`);
const SEED_REF = 'refs/heads/push-seed';
const RETRIES = 5;

const git = (args, opts = {}) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...(opts.tempIndex ? { GIT_INDEX_FILE: TEMP_INDEX } : {}) },
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  }).trim();

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

// Parent for the seed chain: the remote tip if the branch exists there (so
// every seed push is an incremental update), otherwise a root commit.
const remoteTip = git(['ls-remote', 'origin', `refs/heads/${branch}`]).split('\t')[0] || null;

// 1. Every file in HEAD's tree: mode, sha, size, path.
const entries = git(['ls-tree', '-r', '-l', '-z', 'HEAD'])
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const [meta, p] = line.split('\t');
    const [mode, , sha, size] = meta.split(/\s+/);
    return { mode, sha, size: Number(size), path: p };
  });

// 2. Partition into slices: small files first so code lands fast and each
// big video travels alone near the end.
entries.sort((a, b) => a.size - b.size);
const slices = [];
let current = [], currentBytes = 0;
for (const e of entries) {
  if (current.length && currentBytes + e.size > CHUNK_BYTES) {
    slices.push(current);
    current = [];
    currentBytes = 0;
  }
  current.push(e);
  currentBytes += e.size;
}
if (current.length) slices.push(current);
console.log(`${branch}: ${entries.length} files -> ${slices.length} slices`);

// 3. Seed each cumulative slice as a commit on the throwaway branch.
try {
  git(['read-tree', '--empty'], { tempIndex: true });
  let parent = remoteTip;
  slices.forEach((slice, i) => {
    const sliceMb = slice.reduce((s, e) => s + e.size, 0) / 1048576;
    const indexInfo = slice.map((e) => `${e.mode} ${e.sha}\t${e.path}`).join('\n') + '\n';
    git(['update-index', '--add', '--index-info'], { tempIndex: true, input: indexInfo });
    const tree = git(['write-tree'], { tempIndex: true });
    const commit = git([
      'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `seed slice ${i + 1}/${slices.length}`,
    ]);
    process.stdout.write(`slice ${i + 1}/${slices.length} (${sliceMb.toFixed(0)} MB) pushing... `);
    for (let attempt = 1; ; attempt++) {
      try {
        git(['push', 'origin', `+${commit}:${SEED_REF}`]);
        console.log('ok');
        break;
      } catch (err) {
        if (attempt >= RETRIES) throw err;
        console.log(`failed (attempt ${attempt}), retrying...`);
      }
    }
    parent = commit;
  });

  // 4. The real push: every blob and tree is already on the server.
  console.log(`pushing ${branch}...`);
  git(['push', 'origin', branch]);
  console.log(`${branch} pushed. deleting seed branch...`);
  git(['push', 'origin', `:${SEED_REF}`]);
  console.log('done.');
} finally {
  rmSync(TEMP_INDEX, { force: true });
}
