/**
 * The pure core of the work.yaml editor: apply edited project data onto the
 * existing YAML TEXT without losing comments or formatting.
 *
 * Strategy: never regenerate the file. Parse to a Document, then REUSE the
 * existing nodes: projects are matched by slug, links/assets by `_id` (their
 * index in the file at load time, stamped by `stampIds`). Reordering
 * rearranges node lists (comments attached to nodes ride along); field edits
 * mutate scalar values in place (style and neighbors survive); new items are
 * created; the file's leading comment block is split off as plain text and
 * re-prepended, so the header can never travel with a reordered first project.
 *
 * Only EDITABLE fields are synced. Structural fields (device, transition,
 * thumb*, marketing*, ripple, appStoreUrl, deepDive, slug) are never written,
 * so a client bug cannot clobber them.
 */
import { parseDocument, isMap, isScalar, isSeq } from 'yaml';
import type { Document, YAMLMap, Pair, Scalar } from 'yaml';
import type { Project, Action, Asset } from '../../src/data/schema.ts';

export type Stamped<T> = T & { _id?: number };
export type EditedProject = Omit<Project, 'links' | 'assets'> & {
  links: Stamped<Action>[];
  assets: Stamped<Asset>[];
};

/** Editable plain-text fields, synced verbatim. `date` is special (optional, deletable). */
const TEXT_FIELDS = ['title', 'cardTitle', 'role', 'subtitle', 'cardDesc', 'blurb'] as const;

/** Canonical key orders, used to position newly inserted keys. */
const PROJECT_KEYS = [
  'slug', 'title', 'cardTitle', 'role', 'subtitle', 'date', 'cardDesc', 'blurb',
  'device', 'thumbClass', 'thumbImage', 'transition', 'deepDive',
  'marketingUrl', 'marketingLabel', 'appStoreUrl', 'links', 'assets', 'ripple',
];
const LINK_KEYS = ['label', 'href'];
const ASSET_KEYS = ['type', 'src', 'alt', 'orientation', 'poster'];

/** Stamp each link/asset with its index in the loaded file, the id `applyEdits` matches on. */
export function stampIds(projects: Project[]): EditedProject[] {
  return projects.map((p) => ({
    ...p,
    links: p.links.map((l, i) => ({ ...l, _id: i })),
    assets: p.assets.map((a, i) => ({ ...a, _id: i })),
  }));
}

/**
 * The `public/`-relative directory new images for this project are saved to:
 * the most frequent directory among its existing assets (first seen wins
 * ties), falling back to `/<slug>`.
 */
export function inferAssetDir(project: Pick<EditedProject, 'slug' | 'assets'>): string {
  const dirs = (project.assets ?? [])
    .map((a) => a.src)
    .filter((s) => s.startsWith('/'))
    .map((s) => s.slice(0, s.lastIndexOf('/')) || '/');
  if (dirs.length === 0) return `/${project.slug}`;
  const counts = new Map<string, number>();
  for (const d of dirs) counts.set(d, (counts.get(d) ?? 0) + 1);
  let best = dirs[0];
  for (const d of dirs) if (counts.get(d)! > counts.get(best)!) best = d;
  return best;
}

/** Apply edited projects onto the YAML text, preserving comments and formatting. */
export function applyEdits(yamlText: string, edited: EditedProject[]): string {
  // Leading comment/blank block = the file header. Keep it as text so it can
  // never attach to (and travel with) the first project node.
  const header = yamlText.match(/^(?:#[^\n]*\n|[ \t]*\n)*/)![0];
  const body = yamlText.slice(header.length);

  const doc = parseDocument(body);
  if (doc.errors.length > 0) throw new Error(`work.yaml parse failed: ${doc.errors[0].message}`);
  const seq = doc.contents;
  if (!isSeq(seq)) throw new Error('work.yaml: expected a top-level list of projects');

  const bySlug = new Map<string, YAMLMap>();
  for (const item of seq.items) {
    if (isMap(item)) bySlug.set(String(item.get('slug')), item);
  }

  const reordered = edited.map((p) => {
    const node = bySlug.get(p.slug);
    if (!node) throw new Error(`unknown project slug: ${p.slug}`);
    syncProject(doc, node, p);
    return node;
  });
  // Exactly one blank line between projects, none before the first.
  reordered.forEach((node, i) => {
    node.spaceBefore = i > 0;
  });
  // The nodes ARE this document's parsed nodes (we only reorder and mutate
  // them), but the static Parsed types don't carry through the slug map.
  seq.items = reordered as unknown as typeof seq.items;

  return header + doc.toString({ lineWidth: 0 });
}

function syncProject(doc: Document, node: YAMLMap, p: EditedProject): void {
  for (const f of TEXT_FIELDS) setScalar(doc, node, f, p[f], PROJECT_KEYS);
  if (p.date && p.date.trim()) setScalar(doc, node, 'date', p.date, PROJECT_KEYS);
  else node.delete('date');
  syncList(doc, node, 'links', p.links ?? [], syncLink);
  syncList(doc, node, 'assets', p.assets ?? [], syncAsset);
}

function syncLink(doc: Document, node: YAMLMap, l: Stamped<Action>): void {
  setScalar(doc, node, 'label', l.label, LINK_KEYS);
  setScalar(doc, node, 'href', l.href, LINK_KEYS);
}

function syncAsset(doc: Document, node: YAMLMap, a: Stamped<Asset>): void {
  // `type: image` is the schema default: never ADD it, but keep an existing
  // explicit key in sync (some entries spell it out).
  const type = a.type ?? 'image';
  if (node.has('type') || type !== 'image') setScalar(doc, node, 'type', type, ASSET_KEYS);
  setScalar(doc, node, 'src', a.src, ASSET_KEYS);
  setScalar(doc, node, 'alt', a.alt, ASSET_KEYS);
  setScalar(doc, node, 'orientation', a.orientation, ASSET_KEYS);
  if (a.poster) setScalar(doc, node, 'poster', a.poster, ASSET_KEYS);
}

/**
 * Set `key` to a scalar `value` on `map`. An existing scalar node is mutated
 * in place (its quote style and attached comments survive; the stringifier
 * re-quotes automatically if the new value needs it). A missing key is
 * inserted at its canonical position per `keyOrder`, not appended.
 */
function setScalar(doc: Document, map: YAMLMap, key: string, value: unknown, keyOrder: string[]): void {
  const cur = map.get(key, true);
  if (isScalar(cur)) {
    if (cur.value !== value) cur.value = value;
    return;
  }
  if (cur !== undefined) {
    map.set(key, value);
    return;
  }
  insertPair(map, doc.createPair(key, value), key, keyOrder);
}

/**
 * Replace the `key` list of `projectMap` with `items`, reusing each original
 * node when the edited item carries its `_id` (so comments ride along through
 * reorders) and creating nodes for new items. An empty list deletes the key
 * (the schema defaults a missing list to []).
 */
function syncList(
  doc: Document,
  projectMap: YAMLMap,
  key: 'links' | 'assets',
  editedItems: (Stamped<Action> | Stamped<Asset>)[],
  syncItem: (doc: Document, node: YAMLMap, item: never) => void,
): void {
  if (editedItems.length === 0) {
    projectMap.delete(key);
    return;
  }
  const seqNode = projectMap.get(key, true);
  const orig: YAMLMap[] = isSeq(seqNode) ? seqNode.items.filter((n): n is YAMLMap => isMap(n)) : [];
  // A comment between the `links:`/`assets:` key and the first item parses as
  // the SEQ's commentBefore, but in this file's idiom it annotates the first
  // item (all the "# TODO: real ... URL" lines). Reattach it to that item so
  // it renders identically in place AND travels with the item on reorder.
  if (isSeq(seqNode) && seqNode.commentBefore && orig[0]) {
    orig[0].commentBefore = orig[0].commentBefore
      ? `${seqNode.commentBefore}\n${orig[0].commentBefore}`
      : seqNode.commentBefore;
    seqNode.commentBefore = undefined;
  }
  const items = editedItems.map((item) => {
    const node =
      typeof item._id === 'number' && orig[item._id]
        ? orig[item._id]
        : (doc.createNode(newItemShape(key, item)) as YAMLMap);
    syncItem(doc, node, item as never);
    return node;
  });
  if (isSeq(seqNode)) {
    seqNode.items = items;
  } else {
    insertPair(projectMap, doc.createPair(key, items), key, PROJECT_KEYS);
  }
}

/** The YAML shape for a brand-new list item, keys in canonical order, defaults omitted. */
function newItemShape(key: 'links' | 'assets', item: Stamped<Action> | Stamped<Asset>): Record<string, unknown> {
  if (key === 'links') {
    const l = item as Stamped<Action>;
    return { label: l.label, href: l.href };
  }
  const a = item as Stamped<Asset>;
  const shape: Record<string, unknown> = {};
  if (a.type && a.type !== 'image') shape.type = a.type;
  shape.src = a.src;
  shape.alt = a.alt;
  shape.orientation = a.orientation;
  if (a.poster) shape.poster = a.poster;
  return shape;
}

/** Insert `pair` so the map's keys keep their canonical relative order. */
function insertPair(map: YAMLMap, pair: Pair, key: string, keyOrder: string[]): void {
  const rank = keyOrder.indexOf(key);
  let at = map.items.length;
  for (let i = 0; i < map.items.length; i++) {
    const k = String((map.items[i].key as Scalar).value);
    const pos = keyOrder.indexOf(k);
    if (pos !== -1 && pos > rank) {
      at = i;
      break;
    }
  }
  map.items.splice(at, 0, pair);
}
