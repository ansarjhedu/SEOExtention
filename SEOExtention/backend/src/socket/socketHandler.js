import { runDeepCrawl, activeCrawls } from '../services/crawlerService.js';

const getCleanDomain = (urlStr) => {
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
};

const socketToDomainMap = new Map();

export const handleSocketConnections = (io) => {
  io.on('connection', (socket) => {
    console.log(`Extension client connected: ${socket.id}`);

    // Heartbeat sync on tab focus or reconnect
    socket.on('check_active_crawl', (data) => {
      const { targetUrl } = data;
      if (!targetUrl) return;

      const domain = getCleanDomain(targetUrl);
      const existing = activeCrawls.get(domain);

      if (existing) {
        existing.socket = socket;
        socketToDomainMap.set(socket.id, domain);
        console.log(`Auto-rebound socket ${socket.id} to background task for: ${domain}`);

        socket.emit('crawl_status', {
          status: 'processing',
          message: `Reconnected!`,
          progress: existing.progress,
          linksFoundCount: existing.discoveredLinks.length,
          pagesCrawled: existing.pagesCrawledCount,
          queueSize: existing.queue.length,
        });

        // Single-engine update
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
      }
    });

    socket.on('start_deep_crawl', async (data) => {
      const { targetUrl } = data;
      const domain = getCleanDomain(targetUrl);
      socketToDomainMap.set(socket.id, domain);
      await runDeepCrawl(targetUrl, socket);
    });

    socket.on('pause_crawl', () => {
      const domain = socketToDomainMap.get(socket.id);
      const session = activeCrawls.get(domain);
      if (session) {
        session.isPaused = true;
        socket.emit('crawl_status_update', { isPaused: true, isTerminated: false });
      }
    });

    socket.on('resume_crawl', () => {
      const domain = socketToDomainMap.get(socket.id);
      const session = activeCrawls.get(domain);
      if (session) {
        session.isPaused = false;
        socket.emit('crawl_status_update', { isPaused: false, isTerminated: false });
      }
    });

    socket.on('terminate_crawl', () => {
      const domain = socketToDomainMap.get(socket.id);
      const session = activeCrawls.get(domain);
      if (session) {
        session.isTerminated = true;
        if (session.limiter) {
          session.limiter.stop();
        }
        socket.emit('crawl_status_update', { isPaused: false, isTerminated: true });
        console.log(`Crawl session terminated and memory cleared for: ${domain}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}. Task continues running in the background.`);
      socketToDomainMap.delete(socket.id);
    });
  });
};
