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
      message: `Reconnected! Scanning remaining pages...`,
      progress: existing.progress,
      linksFoundCount: existing.discoveredLinks.length,
      pagesCrawled: existing.pagesCrawledCount,
      queueSize: existing.queue.length,
    });

    emitGroupedDataUpdate(existing);
    return;
  }

  // --- INITIALIZE SESSION STATE ---
  const canonicalRoot = canonicalizeUrl(targetUrl);
  activeCrawls.set(domain, {
    socket,
    isPaused: false,
    isTerminated: false,
    limiter: new Bottleneck({ maxConcurrent: 1, minTime: 600 }),
    visitedUrls: new Set(),
    scannedIndex: new Set(), // 100% secure lock preventing duplicate execution
    discoveredLinks: [],
    seenUniqueLinks: new Set(),
    pagesCrawledCount: 0,
    queue: [canonicalRoot],
    currentUrl: '',
    engineStatus: 'idle',
    progress: 1,

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
  const maxSafetyCeiling = 3000;

  try {
    const rootUrl = new URL(targetUrl);
    const targetDomain = getCleanDomain(targetUrl);

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
      message: `Scanning and extracting page details in real-time...`,
      progress: 2,
      pagesCrawled: 0,
      queueSize: 1,
    });

    emitEngineUpdate();

    const processPage = async (url) => {
      // Checked index lock - strictly prevents any duplicate execution
      if (session.isTerminated || session.scannedIndex.has(url) || session.pagesCrawledCount >= maxSafetyCeiling) return;
      session.scannedIndex.add(url);
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

        // Instant, on-the-fly extraction of pricing/metadata from the DOM
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

        // Extract dealership profile on startup index pages
        if (session.pagesCrawledCount <= 5) {
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

          session.dealershipProfile.lendingPartners = [...new Set([...(session.dealershipProfile.lendingPartners || []), ...(pageProfile?.lendingPartners || [])])];
          session.dealershipProfile.programsOffered = [...new Set([...(session.dealershipProfile.programsOffered || []), ...(pageProfile?.programsOffered || [])])];
          session.dealershipProfile.claims = [...new Set([...(session.dealershipProfile.claims || []), ...(pageProfile?.claims || [])])];
          session.dealershipProfile.tiers = [...new Set([...(session.dealershipProfile.tiers || []), ...(pageProfile?.tiers || [])])];
        }

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
      if (!nextUrl || session.scannedIndex.has(nextUrl)) continue;

      try {
        await session.limiter.schedule(() => processPage(nextUrl));
      } catch (err) {
        console.error(`Page crawl error on ${nextUrl}: ${err.message}`);
        session.engineStatus = 'idle';
        emitEngineUpdate();
      }
    }

    // --- DB PERSISTENCE ---
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