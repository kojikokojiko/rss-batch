// src/fetchRSSFeed.ts
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface OGPData {
  ogImage: string | null;
}

const fetchOGPData = async (url: string): Promise<OGPData> => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Error fetching URL: ${response.statusText}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    
    const ogImage = $("meta[property='og:image']").attr('content') || null;

    return { ogImage };
  } catch (error) {
    console.error(`Error fetching OGP data for ${url}:`, error);
    return { ogImage: null };
  }
};

const fetchRSSFeed = async (feedId: number,feedUrl: string) => {
  try {
    const hostname = new URL(feedUrl).hostname;
    const media = await prisma.media.findUnique({ where: { hostname: hostname } });

    if (!media) throw new Error('Media not found');

    const response = await fetch(feedUrl);
    if (!response.ok) throw new Error(`Error fetching RSS feed: ${response.statusText}`);

    const xmlText = await response.text();
    const $ = cheerio.load(xmlText, { xmlMode: true });
    
    const items = await Promise.all(
      $(media.item_selector).map(async (i, item) => {
        const title = $(item).find(media.item_title_selector).text() || '';
        const link = $(item).find(media.item_link_selector).text() || '';
        const description = $(item).find(media.item_desc_selector).text() || '';
        const pubDate = $(item).find(media.item_pubdate_selector).text() || '';

        const ogpData = link ? await fetchOGPData(link) : { ogImage: null };

        return { title, link, description, pubDate, ...ogpData };
      }).get()
    );

    const feed = {
      mediaId: media.id,
      feed: {
        title: $(media.feed_title_selector).text() || 'No title',
        description: $(media.feed_desc_selector).text() || 'No description',
        lastUpdated: $(media.feed_last_updated_selector).text() || 'No date',
      },
      items,
    };

    // Prepare data for bulk insert
    const entriesToCreate = items.map(item => ({
      feed_id: feedId,
      title: item.title,
      link: item.link,
      description: item.description,
      content: item.description, // Using description as content
      image_url: item.ogImage,
      published_at: new Date(item.pubDate),
    }));

    // Bulk insert entries
    await prisma.entries.createMany({
      data: entriesToCreate,
      skipDuplicates: true, // This will skip entries with duplicate 'link' values
    });

    console.log(JSON.stringify(feed, null, 2));
  } catch (error) {
    console.error('Error: ', error instanceof Error ? error.message : String(error));
  } finally {
    await prisma.$disconnect();
  }
};


const main = async () => {
  try {
    // Get only id and URL from feeds
    const feeds = await prisma.feeds.findMany({
      select: { id: true, url: true },
    });
    
    // Process each feed
    for (const feed of feeds) {
      console.log(`Fetching feed ${feed.id}...`);
      if (feed.url) { // Ensure URL is not null or undefined
        await fetchRSSFeed(feed.id, feed.url);
      }
    }  
  } catch (error) {
    console.error('Error fetching feeds: ', error instanceof Error ? error.message : String(error));
  } finally {
    await prisma.$disconnect();
  }
};



main();