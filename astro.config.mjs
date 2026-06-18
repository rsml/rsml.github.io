import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static output (default). Custom-domain root site, so no `base` path.
export default defineConfig({
  site: 'https://rossmiller.dev',
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'always',
  },
});
