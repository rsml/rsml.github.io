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
