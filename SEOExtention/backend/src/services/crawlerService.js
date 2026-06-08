import axios from 'axios';
import * as cheerio from 'cheerio';
import Bottleneck from 'bottleneck';
import https from 'node:https';
import Scan from '../models/Scan.js';

export const activeCrawls = new Map();

const getCleanDomain = (urlStr) => {
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
};

const assetExtensions = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.ico',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.flv', '.wmv', '.ogg', '.webm',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.xml', '.json', '.css', '.js'
];

function isAssetUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname.toLowerCase();
    return assetExtensions.some(ext => pathname.endsWith(ext));
  } catch (e) {
    return false;
  }
}

function getUrlCategory(urlStr, targetUrlStr) {
  const lowerUrl = urlStr.toLowerCase();

  if (lowerUrl.includes('/products/')) return 'product';
  if (lowerUrl.includes('/collections/')) return 'collection';
  if (lowerUrl.includes('/blogs/') || lowerUrl.includes('/articles/')) return 'blog';

  const staticPagePaths = ['/about', '/contact', '/faq', '/privacy', '/terms', '/policy', '/support', '/services', '/help', '/info'];
  
  try {
    const url = new URL(urlStr);
    const target = new URL(targetUrlStr);
    const pathname = url.pathname.toLowerCase();

    const isRoot = url.origin === target.origin && (pathname === '/' || pathname === '');
    const hasShopifyPagesPrefix = lowerUrl.includes('/pages/');
    const isCommonStaticPage = staticPagePaths.some(path => pathname === path || pathname === path + '/');

    if (isRoot || hasShopifyPagesPrefix || isCommonStaticPage) {
      return 'page';
    }
  } catch (e) {}

  return 'other';
}

export const runDeepCrawl = async (targetUrl, socket) => {
  try {
    const parsedTarget = new URL(targetUrl);
    targetUrl = parsedTarget.toString();
  } catch (e) {}

  const domain = getCleanDomain(targetUrl);

  // --- RECONNECTION: Bind new socket to an existing in-progress crawl ---
  if (activeCrawls.has(domain)) {
    const existing = activeCrawls.get(domain);
    existing.socket = socket;

    socket.emit('crawl_status', {
      status: 'processing',
      message: `Reconnected!`,
      progress: existing.progress,
      linksFoundCount: existing.discoveredLinks.length,
      pagesCrawled: existing.pagesCrawledCount,
      queueSize: existing.queue.length,
    });

    // Emit workers_update as a single-engine array so the UI renders correctly
    socket.emit('workers_update', [{
      id: 1,
      queueSize: existing.queue.length,
      processedCount: existing.pagesCrawledCount,
      currentUrl: existing.currentUrl,
      status: existing.engineStatus
    }]);

    if (existing.discoveredLinks.length > 0) {
      socket.emit('links_discovered', existing.discoveredLinks);
    }
    return;
  }

  // --- INITIALIZE SESSION ---
  activeCrawls.set(domain, {
    socket,
    isPaused: false,
    isTerminated: false,
    // Single-threaded Bottleneck: one request at a time, polite delay between requests
    limiter: new Bottleneck({ maxConcurrent: 1, minTime: 600 }),
    visitedUrls: new Set(),
    discoveredLinks: [],
    seenUniqueLinks: new Set(),
    pagesCrawledCount: 0,
    progress: 2,
    targetUrl,
    queue: [targetUrl],       // Single flat queue — no worker splitting
    currentUrl: '',           // Currently active URL (for UI display)
    engineStatus: 'idle',     // Single engine status
  });

  const session = activeCrawls.get(domain);
  const maxPagesToCrawl = 250;

  try {
    const rootUrl = new URL(targetUrl);
    const targetDomain = getCleanDomain(targetUrl);

    // --- Emit initial engine state ---
    const emitEngineUpdate = () => {
      session.socket.emit('workers_update', [{
        id: 1,
        queueSize: session.queue.length,
        processedCount: session.pagesCrawledCount,
        currentUrl: session.currentUrl,
        status: session.engineStatus
      }]);
    };

    session.socket.emit('crawl_status', {
      status: 'processing',
      message: `Analyzing root directory...`,
      progress: session.progress,
      pagesCrawled: 0,
      queueSize: 1,
    });

    emitEngineUpdate();

    // -------------------------------------------------------------------
    //  SINGLE-ENGINE PAGE PROCESSOR
    //  Fetches one URL, extracts links, pushes newly found pages to queue.
    //  Retries on 429 with exponential backoff — same logic as before.
    // -------------------------------------------------------------------
    const processPage = async (url) => {
      if (session.isTerminated || session.visitedUrls.has(url) || session.pagesCrawledCount >= maxPagesToCrawl) return;

      session.visitedUrls.add(url);
      session.pagesCrawledCount++;
      session.currentUrl = url;
      session.engineStatus = 'crawling';

      emitEngineUpdate();

      // Human-like jitter delay between requests
      const jitterDelay = Math.floor(Math.random() * 400) + 200;
      await new Promise(resolve => setTimeout(resolve, jitterDelay));

      const maxRetries = 3;
      let attempts = 0;
      let response = null;

      // --- EXPONENTIAL BACKOFF RETRY LOOP ---
      while (attempts < maxRetries) {
        if (session.isTerminated) return;

        try {
          response = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': rootUrl.origin,
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Connection': 'keep-alive',
            },
            timeout: 12000,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          });
          break; // Success
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
            continue;
          } else {
            throw error;
          }
        }
      }

      // --- PARSE HTML & DISCOVER LINKS ---
      if (response && response.data) {
        const $ = cheerio.load(response.data);
        const newlyDiscoveredPageLinks = [];

        $('a').each((_, element) => {
          if (session.isTerminated) return;
          const href = $(element).attr('href');
          if (!href) return;

          try {
            const absoluteUrl = new URL(href, url);
            absoluteUrl.hash = '';

            const utmParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
            utmParams.forEach(param => absoluteUrl.searchParams.delete(param));

            const cleanUrl = absoluteUrl.toString();
            if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) return;
            if (isAssetUrl(cleanUrl)) return;

            const isInternal = getCleanDomain(cleanUrl) === targetDomain;
            if (!isInternal) return;

            let anchorText = $(element).text().trim();
            if (!anchorText) {
              const innerImg = $(element).find('img');
              anchorText = innerImg.length
                ? $(innerImg).attr('alt')?.trim() || '[Image Link]'
                : '[No Text]';
            }

            const linkRecord = {
              url: cleanUrl,
              text: anchorText || '[No Text]',
              type: 'internal',
              category: getUrlCategory(cleanUrl, targetUrl),
              statusCode: 200,
            };

            if (!session.seenUniqueLinks.has(cleanUrl)) {
              session.seenUniqueLinks.add(cleanUrl);
              session.discoveredLinks.push(linkRecord);
              newlyDiscoveredPageLinks.push(linkRecord);
            }

            // Only queue pages not yet visited or already in queue
            if (!session.visitedUrls.has(cleanUrl) && !session.queue.includes(cleanUrl)) {
              session.queue.push(cleanUrl);
            }
          } catch (e) {}
        });

        if (newlyDiscoveredPageLinks.length > 0) {
          session.socket.emit('links_discovered', newlyDiscoveredPageLinks);
        }

        session.progress = Math.min(
          Math.round((session.pagesCrawledCount / maxPagesToCrawl) * 100),
          98
        );

        session.socket.emit('crawl_status', {
          status: 'processing',
          message: `Crawling...`,
          progress: session.progress,
          linksFoundCount: session.discoveredLinks.length,
          pagesCrawled: session.pagesCrawledCount,
          queueSize: session.queue.length,
        });
      }

      session.engineStatus = 'idle';
      session.currentUrl = '';
      emitEngineUpdate();
    };

    // -------------------------------------------------------------------
    //  SINGLE-ENGINE CRAWL LOOP
    //  Sequentially drains the queue one URL at a time.
    //  Supports pause, resume, and terminate cleanly.
    // -------------------------------------------------------------------
    while (session.queue.length > 0 && session.pagesCrawledCount < maxPagesToCrawl) {
      if (session.isTerminated) break;

      if (session.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      const nextUrl = session.queue.shift();

      if (!nextUrl || session.visitedUrls.has(nextUrl)) continue;

      try {
        await session.limiter.schedule(() => processPage(nextUrl));
      } catch (err) {
        console.error(`Crawler error on ${nextUrl}: ${err.message}`);
        session.engineStatus = 'idle';
        session.currentUrl = '';
        emitEngineUpdate();
      }
    }

    // --- SAVE TO DATABASE ---
    await Scan.create({
      targetUrl,
      links: session.discoveredLinks,
      totalFound: session.discoveredLinks.length,
      status: session.isTerminated ? 'failed' : 'completed',
    });

    session.socket.emit('crawl_status', {
      status: session.isTerminated ? 'terminated' : 'completed',
      message: session.isTerminated
        ? `Crawl terminated! Saved ${session.discoveredLinks.length} links to database.`
        : `Completed! Processed ${session.pagesCrawledCount} pages. Found ${session.discoveredLinks.length} links.`,
      progress: 100,
      linksFoundCount: session.discoveredLinks.length,
      pagesCrawled: session.pagesCrawledCount,
      queueSize: 0,
    });

  } catch (error) {
    console.error(`Crawler execution failed:`, error.message);
    if (session?.socket) {
      session.socket.emit('crawl_status', {
        status: 'failed',
        message: `Crawl error: ${error.message}`,
        progress: 0,
      });
    }
  } finally {
    activeCrawls.delete(domain);
  }
};
