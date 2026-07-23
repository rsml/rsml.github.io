import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

// Static output (default). Custom-domain root site, so no `base` path.
export default defineConfig({
  site: 'https://rossmiller.dev',
  integrations: [
    mdx(),
    react(),
    sitemap({
      filter: (page) => {
        // Unlisted recruiter memo: keep /nourish out of the sitemap (it is also
        // noindex'd in-page). Not in any collection, so nothing else links it.
        if (page.includes('/nourish')) return false;
        // /craft/ needs no filter here. The route itself is gated on `deepDive`
        // in craft/[slug].astro, so an unfinished case study is never built at
        // all and cannot reach the sitemap.
        return true;
      },
    }),
  ],
  build: {
    inlineStylesheets: 'always',
  },
});
