import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_META, withBase } from '../site/url';

export async function GET(context: APIContext) {
  const notes = (await getCollection('notes')).sort((a, b) =>
    b.data.publishedDate.localeCompare(a.data.publishedDate),
  );

  return rss({
    title: `${SITE_META.name} — Notes Feed`,
    description: SITE_META.defaultDescription,
    site: context.site ?? SITE_META.canonicalOrigin,
    items: notes.map((note) => ({
      title: note.data.title,
      pubDate: new Date(`${note.data.publishedDate}T00:00:00Z`),
      description: note.data.description,
      link: withBase(`/notes/${note.id}`),
      author: note.data.author,
    })),
  });
}
