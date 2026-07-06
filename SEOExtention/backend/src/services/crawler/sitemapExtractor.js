// services/crawler/sitemapExtractor.js

import * as cheerio from 'cheerio';
import { fetchPage, fetchStealthPage } from './fetcher.js';
import { canonicalizeUrl, getCleanDomain } from './utils.js';

/**
 * Extracts and categorizes all crawlable internal links from a target website sitemap structure.
 * Automatically handles nested sitemap indexes natively while preventing infinite recursive loops.
 */
export async function extractLinksFromSitemap(targetUrl, session, visitedSitemaps = new Set()) {
  const discoveredSitemapLinks = new Set();
  const targetDomain = getCleanDomain(targetUrl);
  
  try {
    const urlObj = new URL(targetUrl);
    // Standard sitemap paths. Only use these if we are at the top level.
   const sitemapTargets = visitedSitemaps.size === 0 
      ? [
          `${urlObj.origin}/sitemap.xml`, 
          `${urlObj.origin}/sitemap_index.xml`,
          `${urlObj.origin}/SiteMapContent.xml`,   // Dealer Spike specific
          `${urlObj.origin}/SiteMapInventory.xml`, // <--- The hidden inventory motherlode!
          `${urlObj.origin}/SiteMapStore.xml`      // Dealer Spike specific
        ] 
      : [targetUrl];

    console.log(`[Sitemap] Initiating secure sitemap discovery for domain: ${targetDomain}`);

    for (const sitemapUrl of sitemapTargets) {
      // Prevent infinite loops by checking if we have already scanned this exact XML file
      if (visitedSitemaps.has(sitemapUrl)) {
        console.log(`[Sitemap] Skipping already visited sitemap to prevent loop: ${sitemapUrl}`);
        continue;
      }
      
      visitedSitemaps.add(sitemapUrl);

      try {
        const response = await fetchStealthPage(sitemapUrl, session, urlObj.origin, false);
        
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
              
              // Recursive Optimization: Safely scan nested sitemaps
              if (canonicalized.endsWith('.xml') && canonicalized !== sitemapUrl) {
                if (!visitedSitemaps.has(canonicalized)) {
                  console.log(`[Sitemap] Nested sitemap index detected: ${canonicalized}. Traversing child tree...`);
                  const childLinks = await extractLinksFromSitemap(canonicalized, session, visitedSitemaps);
                  childLinks.forEach(link => discoveredSitemapLinks.add(link));
                }
              } else {
                discoveredSitemapLinks.add(canonicalized);
              }
            }
          } catch (urlParseError) {
             // Ignore malformed links
          }
        }

        // Optimization: If the primary sitemap yielded results, stop checking alternates (only applies at root level)
        if (visitedSitemaps.size === 1 && discoveredSitemapLinks.size > 0) {
          break;
        }

      } catch (networkFetchError) {
        console.log(`[Sitemap] Path variance unreadable or blocked at (${sitemapUrl}): ${networkFetchError.message}`);
      }
    }

    // Only log the final total at the root level to prevent console spam
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