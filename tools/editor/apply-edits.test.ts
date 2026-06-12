import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { WorkSchema } from '../../src/data/schema.ts';
import { applyEdits, stampIds, inferAssetDir, type EditedProject } from './apply-edits.ts';

/** Parse + validate + stamp, i.e. exactly what GET /api/work serves the client. */
const load = (text: string) => stampIds(WorkSchema.parse(parse(text)));

const FIXTURE = `# ─── HEADER: stays at the top of the file, always ───
# second header line

- slug: alpha
  title: Alpha
  cardTitle: Alpha
  role: Creator
  subtitle: first thing
  cardDesc: Alpha desc
  blurb: Alpha blurb.
  device: iphone
  thumbClass: thumb-a
  transition: fade-slide
  links:
    # TODO: real alpha url
    - label: iOS app
      href: https://example.com/a
    - label: Web app
      href: https://example.com/w
  # NOTE: alpha capture note
  assets:
    - src: /alpha/screenshots/one.png
      alt: 'One: with colon'
      orientation: portrait
    - src: /alpha/screenshots/two.png
      alt: Two
      orientation: portrait

- slug: beta
  title: Beta
  cardTitle: Beta
  role: Founder
  subtitle: second thing
  cardDesc: Beta desc
  blurb: Beta blurb.
  device: desktop
  thumbClass: thumb-b
  transition: fade-slide

- slug: gamma
  title: Gamma
  cardTitle: Gamma
  role: Maker
  subtitle: third thing
  cardDesc: Gamma desc
  blurb: Gamma blurb.
  device: ipad
  thumbClass: thumb-g
  transition: fade-slide
`;

describe('applyEdits', () => {
  it('no-op round-trips the fixture byte-identically', () => {
    expect(applyEdits(FIXTURE, load(FIXTURE))).toBe(FIXTURE);
  });

  it('no-op round-trips the real work.yaml byte-identically', () => {
    const real = readFileSync(new URL('../../src/data/work.yaml', import.meta.url), 'utf8');
    expect(applyEdits(real, load(real))).toBe(real);
  });

  it('keeps the header at the top when projects reorder, and comments travel with their projects', () => {
    const p = load(FIXTURE);
    const out = applyEdits(FIXTURE, [p[2], p[0], p[1]]);
    expect(out.startsWith('# ─── HEADER')).toBe(true);
    expect(WorkSchema.parse(parse(out)).map((w) => w.slug)).toEqual(['gamma', 'alpha', 'beta']);
    // alpha moved but its TODO link comment is still directly above its link
    expect(out).toMatch(/# TODO: real alpha url\n\s+- label: iOS app/);
    // exactly one blank line between projects, none before the first
    expect(out).not.toMatch(/\n\n\n/);
  });

  it('edits text fields, quoting only when needed, preserving neighbors', () => {
    const p = load(FIXTURE);
    p[0].title = 'Alpha: redux';
    p[1].role = 'Founder, CTO';
    const out = applyEdits(FIXTURE, p);
    const parsed = WorkSchema.parse(parse(out));
    expect(parsed[0].title).toBe('Alpha: redux');
    expect(parsed[1].role).toBe('Founder, CTO');
    // untouched scalars keep their original style
    expect(out).toContain("alt: 'One: with colon'");
  });

  it('inserts date after subtitle, and deletes it when emptied', () => {
    const p = load(FIXTURE);
    p[0].date = '2018-present';
    const withDate = applyEdits(FIXTURE, p);
    expect(withDate).toMatch(/subtitle: first thing\n {2}date: 2018-present\n {2}cardDesc:/);
    const p2 = load(withDate);
    p2[0].date = '';
    expect(applyEdits(withDate, p2)).not.toContain('date:');
  });

  it('reorders links with their comments, adds new ones, and drops the key when emptied', () => {
    const p = load(FIXTURE);
    p[0].links = [p[0].links[1], p[0].links[0], { label: 'Docs', href: 'https://example.com/docs' }];
    const out = applyEdits(FIXTURE, p);
    expect(WorkSchema.parse(parse(out))[0].links.map((l) => l.label)).toEqual(['Web app', 'iOS app', 'Docs']);
    // the TODO comment rides with the iOS link to its new position
    expect(out).toMatch(/# TODO: real alpha url\n\s+- label: iOS app/);

    const p2 = load(out);
    p2[0].links = [];
    expect(applyEdits(out, p2)).not.toContain('links:');
  });

  it('reorders assets under their NOTE comment, edits alt, adds image and gif assets', () => {
    const p = load(FIXTURE);
    const [a1, a2] = p[0].assets;
    a2.alt = 'Two, renamed';
    p[0].assets = [
      a2, a1,
      { type: 'image', src: '/alpha/screenshots/three.png', alt: 'Three', orientation: 'portrait' },
      { type: 'gif', src: '/alpha/screenshots/anim.gif', alt: 'Anim', orientation: 'portrait' },
    ];
    const out = applyEdits(FIXTURE, p);
    expect(out).toContain('# NOTE: alpha capture note');
    const assets = WorkSchema.parse(parse(out))[0].assets;
    expect(assets.map((a) => a.alt)).toEqual(['Two, renamed', 'One: with colon', 'Three', 'Anim']);
    // a new plain image gets no `type:` line (absence already means image); a gif does
    expect(out).not.toMatch(/type: image\b/);
    expect(out).toContain('type: gif');
  });

  it('adds a pdf asset with type and poster written', () => {
    const p = load(FIXTURE);
    p[0].assets = [
      ...p[0].assets,
      { type: 'pdf', src: '/alpha/docs/spec.pdf', alt: 'The spec', orientation: 'portrait', poster: '/alpha/docs/spec-poster.png' },
    ];
    const out = applyEdits(FIXTURE, p);
    expect(out).toMatch(/- type: pdf\n {6}src: \/alpha\/docs\/spec\.pdf\n {6}alt: The spec\n {6}orientation: portrait\n {6}poster: \/alpha\/docs\/spec-poster\.png/);
    expect(WorkSchema.parse(parse(out))[0].assets.at(-1)?.type).toBe('pdf');
  });

  it('throws on an unknown slug', () => {
    const p = load(FIXTURE);
    p[0] = { ...p[0], slug: 'nope' };
    expect(() => applyEdits(FIXTURE, p)).toThrow(/unknown project slug/i);
  });
});

describe('stampIds', () => {
  it('stamps links and assets with their original index', () => {
    const p = load(FIXTURE);
    expect(p[0].links.map((l) => l._id)).toEqual([0, 1]);
    expect(p[0].assets.map((a) => a._id)).toEqual([0, 1]);
    expect(p[1].links).toEqual([]);
  });
});

describe('inferAssetDir', () => {
  const proj = (assets: { src: string }[]) =>
    ({ slug: 'x', assets } as unknown as EditedProject);
  it('uses the common directory of existing assets', () => {
    expect(inferAssetDir(proj([{ src: '/x/screenshots/a.png' }, { src: '/x/screenshots/b.png' }])))
      .toBe('/x/screenshots');
  });
  it('uses the most frequent directory when mixed', () => {
    expect(inferAssetDir(proj([{ src: '/x/a.png' }, { src: '/x/shots/b.png' }, { src: '/x/shots/c.png' }])))
      .toBe('/x/shots');
  });
  it('falls back to /<slug> with no assets', () => {
    expect(inferAssetDir(proj([]))).toBe('/x');
  });
});
