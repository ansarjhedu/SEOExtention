// socket/socketHandler.js

import { runDeepCrawl, activeCrawls } from '../services/crawler/crawlerService.js';

const getCleanDomain = (urlStr) => {
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
};

export const handleSocketConnections = (io) => {
  io.on('connection', (socket) => {
    console.log(`Extension client connected: ${socket.id}`);

    socket.on('check_active_crawl', (data) => {
      const { targetUrl } = data;
      if (!targetUrl) return;

      const domain = getCleanDomain(targetUrl);
      const existing = activeCrawls.get(domain);

      if (existing) {
        existing.socket = socket;

        socket.emit('crawl_status', {
          status: 'processing',
          message: existing.phase === 'discovery' 
            ? `Discovering site map...` 
            : `Scanning details... (${existing.extractedCount || 0}/${existing.totalToExtract || 0})`,
          progress: existing.progress,
          linksFoundCount: existing.discoveredLinks.length,
          pagesCrawled: existing.pagesCrawledCount,
          queueSize: existing.queue.length,
        });

        socket.emit('workers_update', [{
          id: 1,
          queueSize: existing.phase === 'discovery' 
            ? (existing.queue?.length || 0) 
            : (existing.extractionQueue?.length || 0),
          processedCount: existing.phase === 'discovery' 
            ? existing.pagesCrawledCount 
            : (existing.extractedCount || 0),
          currentUrl: existing.currentUrl || '',
          status: existing.engineStatus || 'idle'
        }]);

        const groupedData = {
          collections: {
            brandDirectories: existing.discoveredLinks.filter(l => l.subCategory === 'brand-directory'),
            brandModelLists: existing.discoveredLinks.filter(l => l.subCategory === 'brand-model-list'),
            partsDirectories: existing.discoveredLinks.filter(l => l.subCategory === 'parts-directory'),
            comparisonDirectories: existing.discoveredLinks.filter(l => l.subCategory === 'comparison-directory')
          },
          inventory: {
            newInventory: {
              mainLinks: existing.discoveredLinks.filter(l => l.subCategory === 'new-inventory'),
              vehicles: existing.discoveredLinks.filter(l => l.category === 'product' && l.subCategory === 'new-product')
            },
            usedInventory: {
              mainLinks: existing.discoveredLinks.filter(l => l.subCategory === 'used-inventory'),
              vehicles: existing.discoveredLinks.filter(l => l.category === 'product' && l.subCategory === 'used-product')
            },
            generalInventory: {
              mainLinks: existing.discoveredLinks.filter(l => l.category === 'inventory' && l.subCategory === 'general-inventory'),
              vehicles: existing.discoveredLinks.filter(l => l.category === 'product' && l.subCategory === 'general-product')
            }
          },
          staticPages: existing.discoveredLinks.filter(l => l.category === 'page'),
          other: existing.discoveredLinks.filter(l => l.category === 'other')
        };

        socket.emit('crawl_data_grouped', {
          grouped: groupedData,
          dealershipProfile: existing.dealershipProfile
        });
      }
    });

    socket.on('start_deep_crawl', async (data) => {
      const { targetUrl } = data;
      await runDeepCrawl(targetUrl, socket);
    });

    socket.on('pause_crawl', (data) => {
      const { targetUrl } = data;
      if (!targetUrl) return;
      const domain = getCleanDomain(targetUrl);
      const session = activeCrawls.get(domain);
      if (session) {
        session.isPaused = true;
        socket.emit('crawl_status_update', { isPaused: true, isTerminated: false });
      }
    });

    socket.on('resume_crawl', (data) => {
      const { targetUrl } = data;
      if (!targetUrl) return;
      const domain = getCleanDomain(targetUrl);
      const session = activeCrawls.get(domain);
      if (session) {
        session.isPaused = false;
        socket.emit('crawl_status_update', { isPaused: false, isTerminated: false });
      }
    });

    socket.on('terminate_crawl', (data) => {
      const { targetUrl } = data;
      if (!targetUrl) return;
      const domain = getCleanDomain(targetUrl);
      const session = activeCrawls.get(domain);
      if (session) {
        session.isTerminated = true;
        try {
          if (session.limiter) {
            session.limiter.stop(); // Wrapped in try-catch to prevent Bottleneck Error crash
          }
        } catch (e) {
          console.log("Limiter instance stopped safely.");
        }
        socket.emit('crawl_status_update', { isPaused: false, isTerminated: true });
        console.log(`Crawl session stopped and memory cleared for: ${domain}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};