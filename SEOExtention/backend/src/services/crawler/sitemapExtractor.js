// services/crawler/sitemapExtractor.js

import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'node:https';

/**
 * Attempts to fetch and parse a dealership's XML sitemap.
 */
export async function extractLinksFromSitemap(domainUrl) {
  let sitemapUrl = '';
  
  // Clean the URL to get the root
  try {
    const urlObj = new URL(domainUrl);
    sitemapUrl = `${urlObj.origin}/sitemap.xml`;
  } catch (e) {
    return [];
  }

  try {
    console.log(`Checking for sitemap at: ${sitemapUrl}`);
    
    const response = await axios.get(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/xml, text/xml, */*; q=0.01'
      },
      timeout: 10000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });

    if (!response.data) return [];

    const $ = cheerio.load(response.data, { xmlMode: true });
    const discoveredUrls = [];

    // Dealership sitemaps often have sub-sitemaps (sitemap index).
    // Let's grab all <loc> tags from the XML.
    $('loc').each((_, el) => {
      const link = $(el).text().trim().toLowerCase();
      
      // We only care about inventory/product links right now
      if (link.includes('/inventory/') || link.includes('/new/') || link.includes('/used/')) {
        discoveredUrls.push(link);
      }
    });

    console.log(`Sitemap Bypass Success: Instantly found ${discoveredUrls.length} inventory links.`);
    return discoveredUrls;

  } catch (error) {
    console.log(`Sitemap fetch failed for ${sitemapUrl} (Status: ${error.response?.status || error.message}). Falling back to manual crawl.`);
    return [];
  }
}