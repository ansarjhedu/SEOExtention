// services/crawler/fetcher.js

import axios from 'axios';
import https from 'node:https';

/**
 * Fetches HTML from a target URL.
 * Handles rate limits (HTTP 429) and performs up to 3 retry attempts.
 */
export async function fetchPage(url, session, rootUrlOrigin) {
  const maxRetries = 3;
  let attempts = 0;
  let response = null;

  while (attempts < maxRetries) {
    if (session.isTerminated) return null;

    try {
      response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': rootUrlOrigin,
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Connection': 'keep-alive',
        },
        timeout: 12000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });
      return response; // Success
    } catch (error) {
      attempts++;
      const statusCode = error.response
        ? error.response.status
        : (error.code === 'ECONNABORTED' ? 408 : 500);

      if (statusCode === 429 && attempts < maxRetries) {
        const retryHeader = error.response?.headers?.['retry-after'];
        const retryAfter = retryHeader ? parseInt(retryHeader) * 1000 : 3000;

        console.warn(`Rate limit (429) on: ${url}. Waiting ${retryAfter}ms before retry ${attempts}/${maxRetries}...`);

        session.socket.emit('crawl_status', {
          status: 'processing',
          message: `Throttled (429). Retrying in ${Math.round(retryAfter / 1000)}s...`,
          progress: session.progress,
          linksFoundCount: session.discoveredLinks.length,
          pagesCrawled: session.pagesCrawledCount,
          queueSize: session.queue.length,
        });

        await new Promise(resolve => setTimeout(resolve, retryAfter));
      } else {
        throw error;
      }
    }
  }
  return null;
}