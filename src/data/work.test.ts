import { describe, it, expect } from 'vitest';
import { WORK, getWork, getProject } from './work';
import { ProjectSchema } from './schema';

describe('work data', () => {
  it('has the 7 projects in order', () => {
    // Deliberate home card display order (matches the current prototype), not alphabetical.
    expect(getWork().map(w => w.slug)).toEqual([
      'chord-colors', 'tutor', 'forge', 'vivy', 'openpath', 'sms', 'symphony',
    ]);
  });
  it('has unique slugs', () => {
    const slugs = WORK.map(w => w.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it('every project has required card fields', () => {
    for (const w of WORK) {
      expect(w.title, w.slug).toBeTruthy();
      expect(w.cardTitle, w.slug).toBeTruthy();
      expect(w.cardDesc, w.slug).toBeTruthy();
      expect(w.thumbClass, w.slug).toBeTruthy();
    }
  });
  it('only chord-colors uses the ripple, and it carries ripple config', () => {
    for (const w of WORK) {
      if (w.slug === 'chord-colors') {
        expect(w.transition).toBe('ripple');
        expect(w.ripple).toBeDefined();
      } else {
        expect(w.transition).toBe('fade-slide');
      }
    }
  });
  it('marketingUrl is set only for tutor and forge', () => {
    const withMarketing = WORK.filter(w => w.marketingUrl).map(w => w.slug).sort();
    expect(withMarketing).toEqual(['forge', 'tutor']);
    expect(getProject('tutor')?.marketingUrl).toBe('/tutor');
    expect(getProject('forge')?.marketingUrl).toBe('/forge');
  });
  // The Zod schema enforces these at load (a bad value fails the build); the tests
  // document the contract that the lightbox + strip rely on for each asset type.
  it('every asset has a supported type, and video/embed/pdf carry a poster', () => {
    for (const w of WORK) {
      for (const a of w.assets) {
        expect(['image', 'gif', 'video', 'youtube', 'embed', 'pdf'], `${w.slug}: ${a.src}`).toContain(a.type);
        if (a.type === 'video' || a.type === 'embed' || a.type === 'pdf') {
          expect(a.poster, `${w.slug} ${a.type} ${a.src} needs a poster`).toBeTruthy();
        }
      }
    }
  });
  it('every link has a label and an href', () => {
    for (const w of WORK) {
      for (const l of w.links) {
        expect(l.label, w.slug).toBeTruthy();
        expect(l.href, w.slug).toBeTruthy();
      }
    }
  });
});

describe('date field', () => {
  const minimal = {
    slug: 's', title: 'T', cardTitle: 'T', role: 'R', subtitle: 'st',
    cardDesc: 'd', blurb: 'b', device: 'iphone', thumbClass: 'thumb-x',
    transition: 'fade-slide',
  };
  it('is optional', () => {
    expect(ProjectSchema.parse(minimal).date).toBeUndefined();
  });
  it('accepts a freeform string', () => {
    expect(ProjectSchema.parse({ ...minimal, date: '2018-present' }).date).toBe('2018-present');
  });
});

describe('pdf assets', () => {
  const minimal = {
    slug: 's', title: 'T', cardTitle: 'T', role: 'R', subtitle: 'st',
    cardDesc: 'd', blurb: 'b', device: 'iphone', thumbClass: 'thumb-x',
    transition: 'fade-slide',
  };
  const pdf = { type: 'pdf', src: '/x/doc.pdf', alt: 'a doc', orientation: 'portrait' };
  it('requires a poster (a PDF cannot be a strip thumbnail)', () => {
    expect(() => ProjectSchema.parse({ ...minimal, assets: [pdf] })).toThrow(/poster/);
  });
  it('is accepted with a poster', () => {
    const parsed = ProjectSchema.parse({ ...minimal, assets: [{ ...pdf, poster: '/x/doc-poster.png' }] });
    expect(parsed.assets[0].type).toBe('pdf');
  });
});
