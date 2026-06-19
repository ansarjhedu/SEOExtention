// services/crawler/crawlerService.js

import Bottleneck from 'bottleneck';
import Scan from '../../models/Scan.js';

import { activeCrawls } from './state.js';
import { getCleanDomain, canonicalizeUrl } from './utils.js';
import { fetchPage } from './fetcher.js';
import { parseAndExtractLinks, extractPageMetadata, groupDiscoveredLinks, extractDealershipProfile } from './parser.js';

export { activeCrawls };

export const runDeepCrawl = async (targetUrl, socket) => {
  try {
    const parsedTarget = new URL(targetUrl);
    targetUrl = parsedTarget.toString();
  } catch (e) {}

  const domain = getCleanDomain(targetUrl);

  const emitGroupedDataUpdate = (session) => {
    const groupedData = groupDiscoveredLinks(session.discoveredLinks);
    session.socket.emit('crawl_data_grouped', {
      grouped: groupedData,
      dealershipProfile: session.dealershipProfile
    });
  };

  // --- RECONNECTION ---
  if (activeCrawls.has(domain)) {
    const existing = activeCrawls.get(domain);
    existing.socket = socket;

    socket.emit('crawl_status', {
      status: 'processing',
      message: `Reconnected! Processing deep crawls...`,
      progress: existing.progress,
      linksFoundCount: existing.discoveredLinks.length,
      pagesCrawled: existing.pagesCrawledCount,
      queueSize: existing.queue.length,
    });

    emitGroupedDataUpdate(existing);
    return;
  }

  // --- IN-MEMORY INITIALIZER ---
  const canonicalRoot = canonicalizeUrl(targetUrl);
  activeCrawls.set(domain, {
    socket,
    isPaused: false,
    isTerminated: false,
    limiter: new Bottleneck({ maxConcurrent: 1, minTime: 600 }),
    
    // Visited & Scanned Locks
    visitedUrls: new Set(), // Kept for compatibility
    scannedIndex: new Set(), // Strictly locks 100% of fully processed pages (0 = unscanned, 1 = scanned)
    
    discoveredLinks: [],
    seenUniqueLinks: new Set(),
    pagesCrawledCount: 0,
    queue: [canonicalRoot],
    currentUrl: '',
    engineStatus: 'idle',
    progress: 1,

    // Phase Properties
    phase: 'discovery',
    extractionQueue: [],
    extractedCount: 0,
    totalToExtract: 0,

    // Aggregator Context (Fully Preserved)
    dealershipProfile: {
      dealershipName: '',
      legalCorporateName: '',
      dbaAlternateName: '',
      streetAddress: '',
      city: '',
      state: '',
      zipCode: '',
      telephoneMainLine: '',
      salesHours: '',
      serviceHours: '',
      latitude: '',
      longitude: '',
      googleBusinessUrl: '',
      lendingPartners: [],
      programsOffered: [],
      claims: [],
      tiers: []
    }
  });

  const session = activeCrawls.get(domain);
  const maxSafetyCeiling = 5000;

  try {
    const rootUrl = new URL(targetUrl);
    const targetDomain = getCleanDomain(targetUrl);

    const emitEngineUpdate = (queueLengthOverride) => {
      session.socket.emit('workers_update', [{
        id: 1,
        queueSize: queueLengthOverride !== undefined ? queueLengthOverride : session.queue.length,
        processedCount: session.phase === 'discovery' ? session.pagesCrawledCount : session.extractedCount,
        currentUrl: session.currentUrl,
        status: session.engineStatus
      }]);
    };

    // =================================================================
    // PHASE 1: DISCOVERY & DATA EXTRACTION
    // =================================================================
    session.socket.emit('crawl_status', {
      status: 'processing',
      message: `Phase 1/2: Discovering and scanning site pages...`,
      progress: 2,
      pagesCrawled: 0,
      queueSize: 1,
    });

    emitEngineUpdate();

    const processPage = async (url) => {
      // 1. Strict checked index lock - ignores and skips if already fully scanned (state = 1)
      if (session.isTerminated || session.scannedIndex.has(url) || session.pagesCrawledCount >= maxSafetyCeiling) return;
      session.scannedIndex.add(url); // Set checked state index directly to 1/true immediately on start
      session.visitedUrls.add(url);
      
      session.pagesCrawledCount++;
      session.currentUrl = url;
      session.engineStatus = 'crawling';
      emitEngineUpdate();

      const jitterDelay = Math.floor(Math.random() * 300) + 150;
      await new Promise(resolve => setTimeout(resolve, jitterDelay));

      const response = await fetchPage(url, session, rootUrl.origin);

      if (response && response.data) {
        parseAndExtractLinks(response.data, url, targetUrl, targetDomain, session);

        // Price metadata scraper
        const meta = extractPageMetadata(response.data);

        const matchedRecord = session.discoveredLinks.find(link => link.url === url);
        if (matchedRecord) {
          if (matchedRecord.category === 'product') {
            matchedRecord.price = meta.price;
            matchedRecord.verificationStatus = (meta.price && matchedRecord.modelName) ? 'verified' : 'missing';
          } else {
            matchedRecord.verificationStatus = 'not_applicable';
          }
        }

        // Dealership profile aggregator
        const pageProfile = extractDealershipProfile(response.data, url);
        
        if (pageProfile.dealershipName) session.dealershipProfile.dealershipName = pageProfile.dealershipName;
        if (pageProfile.legalCorporateName) session.dealershipProfile.legalCorporateName = pageProfile.legalCorporateName;
        if (pageProfile.dbaAlternateName) session.dealershipProfile.dbaAlternateName = pageProfile.dbaAlternateName;
        if (pageProfile.streetAddress) {
          session.dealershipProfile.streetAddress = pageProfile.streetAddress;
          session.dealershipProfile.city = pageProfile.city;
          session.dealershipProfile.state = pageProfile.state;
          session.dealershipProfile.zipCode = pageProfile.zipCode;
        }
        if (pageProfile.telephoneMainLine) session.dealershipProfile.telephoneMainLine = pageProfile.telephoneMainLine;
        if (pageProfile.salesHours) session.dealershipProfile.salesHours = pageProfile.salesHours;
        if (pageProfile.serviceHours) session.dealershipProfile.serviceHours = pageProfile.serviceHours;
        if (pageProfile.latitude) {
          session.dealershipProfile.latitude = pageProfile.latitude;
          session.dealershipProfile.longitude = pageProfile.longitude;
        }
        if (pageProfile.googleBusinessUrl) session.dealershipProfile.googleBusinessUrl = pageProfile.googleBusinessUrl;

        session.dealershipProfile.lendingPartners = [...new Set([...session.dealershipProfile.lendingPartners, ...pageProfile.lendingPartners])];
        session.dealershipProfile.programsOffered = [...new Set([...session.dealershipProfile.programsOffered, ...pageProfile.programsOffered])];
        session.dealershipProfile.claims = [...new Set([...session.dealershipProfile.claims, ...pageProfile.claims])];
        session.dealershipProfile.tiers = [...new Set([...session.dealershipProfile.tiers, ...pageProfile.tiers])];

        emitGroupedDataUpdate(session);

        const totalEstimatedJobs = session.pagesCrawledCount + session.queue.length;
        session.progress = Math.min(Math.round((session.pagesCrawledCount / totalEstimatedJobs) * 100), 99);

        session.socket.emit('crawl_status', {
          status: 'processing',
          message: `Scanning site... (${session.pagesCrawledCount} completed, ${session.queue.length} in queue)`,
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

    while (session.queue.length > 0 && session.pagesCrawledCount < maxSafetyCeiling) {
      if (session.isTerminated) break;

      if (session.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      const nextUrl = session.queue.shift();
      // Skip if URL was already processed or scanned in our checked index (state = 1)
      if (!nextUrl || session.scannedIndex.has(nextUrl)) continue;

      try {
        await session.limiter.schedule(() => processPage(nextUrl));
      } catch (err) {
        console.error(`Page crawl error on ${nextUrl}: ${err.message}`);
        session.engineStatus = 'idle';
        emitEngineUpdate();
      }
    }

    // =================================================================
    // PHASE 2: METADATA CLEANUP SCAN (Strictly targets VDP products)
    // =================================================================
    if (!session.isTerminated) {
      session.phase = 'extraction';
      
      const unvisitedTargets = [...new Set(
        session.discoveredLinks.filter(
          link => (link.category === 'product' || link.category === 'inventory') && 
                  !session.scannedIndex.has(link.url) // Verify against the scanned checked index
        ).map(link => link.url)
      )];

      if (unvisitedTargets.length > 0) {
        session.extractionQueue = [...unvisitedTargets];
        session.totalToExtract = unvisitedTargets.length;
        session.extractedCount = 0;

        session.socket.emit('crawl_status', {
          status: 'processing',
          message: `Phase 2/2: Verification scan on ${session.totalToExtract} remaining targets...`,
          progress: 90,
          linksFoundCount: session.discoveredLinks.length,
          pagesCrawled: session.pagesCrawledCount,
          queueSize: session.totalToExtract,
        });

        const processTargetPage = async (url) => {
          if (session.isTerminated || session.scannedIndex.has(url)) return;
          session.scannedIndex.add(url); // Set checked state index directly to 1/true immediately on start
          session.visitedUrls.add(url);

          session.pagesCrawledCount++;
          session.extractedCount++;
          session.currentUrl = url;
          session.engineStatus = 'crawling';
          emitEngineUpdate(session.extractionQueue.length);

          const jitterDelay = Math.floor(Math.random() * 400) + 200;
          await new Promise(resolve => setTimeout(resolve, jitterDelay));

          const response = await fetchPage(url, session, rootUrl.origin);

          if (response && response.data) {
            const meta = extractPageMetadata(response.data);

            const matchedRecord = session.discoveredLinks.find(link => link.url === url);
            if (matchedRecord) {
              if (matchedRecord.category === 'product') {
                matchedRecord.price = meta.price;
                matchedRecord.verificationStatus = (meta.price && matchedRecord.modelName) ? 'verified' : 'missing';
              } else {
                matchedRecord.verificationStatus = 'not_applicable';
              }
            }
            emitGroupedDataUpdate(session);
          }

          session.progress = 90 + Math.min(
            Math.round((session.extractedCount / session.totalToExtract) * 9),
            9
          );

          session.socket.emit('crawl_status', {
            status: 'processing',
            message: `Deep scanning remaining details... (${session.extractedCount} / ${session.totalToExtract} pages verified)`,
            progress: session.progress,
            linksFoundCount: session.discoveredLinks.length,
            pagesCrawled: session.pagesCrawledCount,
            queueSize: session.extractionQueue.length,
          });

          session.engineStatus = 'idle';
          session.currentUrl = '';
          emitEngineUpdate(session.extractionQueue.length);
        };

        while (session.extractionQueue.length > 0) {
          if (session.isTerminated) break;

          if (session.isPaused) {
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          }

          const nextTarget = session.extractionQueue.shift();
          if (!nextTarget) continue;

          try {
            await session.limiter.schedule(() => processTargetPage(nextTarget));
          } catch (err) {
            console.error(`Deep scan error on ${nextTarget}: ${err.message}`);
            session.engineStatus = 'idle';
            emitEngineUpdate(session.extractionQueue.length);
          }
        }
      }
    }

    // --- MONGO DB WRITE ---
    await Scan.create({
      targetUrl,
      links: session.discoveredLinks,
      totalFound: session.discoveredLinks.length,
      status: session.isTerminated ? 'failed' : 'completed',
      dealershipMetadata: {
        dealershipName: session.dealershipProfile.dealershipName,
        legalCorporateName: session.dealershipProfile.legalCorporateName,
        dbaAlternateName: session.dealershipProfile.dbaAlternateName,
        streetAddress: session.dealershipProfile.streetAddress,
        city: session.dealershipProfile.city,
        state: session.dealershipProfile.state,
        zipCode: session.dealershipProfile.zipCode,
        telephoneMainLine: session.dealershipProfile.telephoneMainLine,
        salesHours: session.dealershipProfile.salesHours,
        serviceHours: session.dealershipProfile.serviceHours,
        latitude: session.dealershipProfile.latitude,
        longitude: session.dealershipProfile.longitude,
        googleBusinessUrl: session.dealershipProfile.googleBusinessUrl,
        financeDetails: {
          lendingPartners: session.dealershipProfile.lendingPartners,
          programsOffered: session.dealershipProfile.programsOffered
        },
        serviceDetails: {
          tiers: session.dealershipProfile.tiers,
          claims: session.dealershipProfile.claims
        }
      }
    });

    emitGroupedDataUpdate(session);

    session.socket.emit('crawl_status', {
      status: session.isTerminated ? 'terminated' : 'completed',
      message: `Scanning completed successfully! All links saved.`,
      progress: 100,
      linksFoundCount: session.discoveredLinks.length,
      pagesCrawled: session.pagesCrawledCount,
      queueSize: 0,
    });

  } catch (error) {
    console.error(`Execution error:`, error.message);
  } finally {
    activeCrawls.delete(domain);
  }
};