// services/crawler/sitemapExtractor.js

import * as cheerio from 'cheerio';
import { fetchPage } from './fetcher.js';
import { canonicalizeUrl, getCleanDomain } from './utils.js';

export async function extractLinksFromSitemap(targetUrl, session, visitedSitemaps = new Set()) {
  const discoveredSitemapLinks = new Set();
  const targetDomain = getCleanDomain(targetUrl);
  
  try {
    const urlObj = new URL(targetUrl);
    const sitemapTargets = visitedSitemaps.size === 0 
      ? [
          `${urlObj.origin}/sitemap.xml`, 
          `${urlObj.origin}/sitemap_index.xml`,
          `${urlObj.origin}/SiteMapContent.xml`, 
          `${urlObj.origin}/SiteMapInventory.xml`, 
          `${urlObj.origin}/SiteMapStore.xml` 
        ] 
      : [targetUrl];

    console.log(`[Sitemap] Initiating secure sitemap discovery for domain: ${targetDomain}`);

    for (const sitemapUrl of sitemapTargets) {
      if (visitedSitemaps.has(sitemapUrl)) continue;
      
      visitedSitemaps.add(sitemapUrl);

      try {
        const response = await fetchPage(sitemapUrl, session);
        if (!response || !response.data) continue;

        const $ = cheerio.load(response.data, { xml: true });
        const locElements = $('loc').toArray();

        console.log(`[Sitemap] Scanned path (${sitemapUrl}) -> Found ${locElements.length} potential XML loc entries.`);

        for (const element of locElements) {
          const rawLink = $(element).text().trim();
          if (!rawLink) continue;

          try {
            const canonicalized = canonicalizeUrl(rawLink);
            
            if (getCleanDomain(canonicalized) === targetDomain) {
              // 🚨 CRITICAL FIX: Detect DealerSpike dynamic sitemaps (page=xsitemap) 🚨
              const isNestedSitemap = canonicalized.endsWith('.xml') || canonicalized.includes('page=xsitemap');

              if (isNestedSitemap && canonicalized !== sitemapUrl) {
                if (!visitedSitemaps.has(canonicalized)) {
                  console.log(`[Sitemap] Nested sitemap index detected: ${canonicalized}. Traversing child tree...`);
                  const childLinks = await extractLinksFromSitemap(canonicalized, session, visitedSitemaps);
                  (childLinks || []).forEach(link => discoveredSitemapLinks.add(link));
                }
              } else {
                discoveredSitemapLinks.add(canonicalized);
              }
            }
          } catch (urlParseError) {}
        }

        if (visitedSitemaps.size === 1 && discoveredSitemapLinks.size > 0) {
          break;
        }

      } catch (networkFetchError) {
        console.log(`[Sitemap] Path variance unreadable or blocked at (${sitemapUrl}): ${networkFetchError.message}`);
      }
    }

    if (visitedSitemaps.size === 1 || visitedSitemaps.size === 2) {
       const finalUrlList = Array.from(discoveredSitemapLinks);
       console.log(`[Sitemap] Discovery complete. Extracted ${finalUrlList.length} secure unique URLs from sitemaps.`);
       return finalUrlList;
    }
    
    return Array.from(discoveredSitemapLinks);

  } catch (fatalSitemapError) {
    console.error(`[Sitemap] Failed to process sitemap architectures safely:`, fatalSitemapError.message);
    return []; 
  }
}