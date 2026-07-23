import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

/**
 * RSS feed for the writing section, served at /rss.xml.
 *
 * Exists so essays can travel past people who already visit the site, because
 * readers subscribe and aggregators pick posts up. Advertised from every page
 * via the `rel="alternate"` link in `BaseHead.astro`, which is where feed
 * readers and crawlers look for it.
 *
 * `context.site` comes from `site` in astro.config.mjs. RSS requires absolute
 * URLs, so `link` is built against it rather than being a bare path.
 */
export async function GET(context: APIContext) {
  const posts = (await getCollection('writing')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime()
  );

  return rss({
    title: 'Ross Miller',
    description: 'Writing on software engineering, AI coding agents, and product craft.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: new URL(`/writing/${post.id}/`, context.site).toString(),
    })),
    customData: '<language>en-us</language>',
  });
}
