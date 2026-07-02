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
        if (page.includes('/craft/')) {
          return page.endsWith('/craft/chord-colors/') || page.endsWith('/craft/tutor/');
        }
        return true;
      },
    }),
  ],
  build: {
    inlineStylesheets: 'always',
  },
});
