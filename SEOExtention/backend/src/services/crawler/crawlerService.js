// services/crawler/crawlerService.js

import Bottleneck from "bottleneck";
import { activeCrawls } from "./state.js";
import { getCleanDomain, canonicalizeUrl } from "./utils.js";
import { fetchPage } from "./fetcher.js";
import { mapCrawlerDataForSheets } from "../exporter/dataMapper.js";
import { createCrawlerReportWorkbook } from "../exporter/googleSheets.js";
import {
  parseAndExtractLinks,
  extractPageMetadata,
  groupDiscoveredLinks,
  extractDealershipProfile,
} from "./parser.js";
import { extractLinksFromSitemap } from "./sitemapExtractor.js";
import { sniffPlatformAPI } from "./platformSniffer.js";

export { activeCrawls };

export const runDeepCrawl = async (targetUrl, socket) => {
  let domain = "";
  try {
    try {
      const parsedTarget = new URL(targetUrl);
      targetUrl = parsedTarget.toString();
      domain = getCleanDomain(targetUrl);
    } catch (urlError) {
      console.error(`Malformed target URL provided: ${targetUrl}`);
      socket.emit("crawl_status", {
        status: "failed",
        message: "Invalid target URL format.",
        progress: 0,
      });
      return;
    }

    const rootUrl = new URL(targetUrl);

    if (activeCrawls.has(domain)) {
      console.log(`Crawl already active for domain: ${domain}. Reconnecting socket channel.`);
      const existing = activeCrawls.get(domain);
      existing.socket = socket;

      socket.emit("crawl_status", {
        status: "processing",
        message: `Reconnected to active session... Phase: ${existing.phase}`,
        progress: existing.progress,
        linksFoundCount: existing.discoveredLinks.length,
        pagesCrawled: existing.pagesCrawledCount || 0,
        queueSize:
          (existing.queue ? existing.queue.length : 0) +
          (existing.extractionQueue ? existing.extractionQueue.length : 0),
      });

      const groupedData = groupDiscoveredLinks(existing.discoveredLinks);
      socket.emit("crawl_data_grouped", {
        grouped: groupedData,
        dealershipProfile: existing.dealershipProfile,
      });
      return;
    }

    const session = {
      socket,
      phase: "discovery",
      progress: 5,
      discoveredLinks: [],
      seenUniqueLinks: new Set([targetUrl]),
      visitedUrls: new Set(),
      scannedIndex: new Set(),
      queue: [{ url: targetUrl, depth: 0 }],
      extractionQueue: [],
      totalToExtract: 0,
      extractedCount: 0,
      pagesCrawledCount: 0,
      isPaused: false,
      isTerminated: false,
      engineStatus: "idle",
      currentUrl: "",
      dealershipProfile: {
        dealershipName: "",
        legalCorporateName: "",
        dbaAlternateName: "",
        streetAddress: "",
        city: "",
        state: "",
        zipCode: "",
        telephoneMainLine: "",
        telephoneFax: "", 
        latitude: "",
        longitude: "",
        googleBusinessUrl: "",
        logoUrl: "",
        platform: "", 
        socialLinks: { facebook: "", instagram: "", youtube: "", twitter: "" },
        requiredUrls: { parts: "", service: "", finance: "" },
        actionUrls: {
          serviceScheduler: "",
          partsRequest: "",
          tradeIn: "",
          testRide: "",
          staff: "",
          blog: "",
          events: "",
          testimonials: "",
        }, 
        departmentPhones: { sales: "", service: "", parts: "" }, 
        storeHours: {
          monday: "",
          tuesday: "",
          wednesday: "",
          thursday: "",
          friday: "",
          saturday: "",
          sunday: "",
        },
        inventoryMetrics: { 
          newCount: 0, 
          usedCount: 0, 
          newPercentage: '0%', 
          usedPercentage: '0%', 
          topBrands: [], 
          topCategories: [] 
        },
        financeDetails: { lendingPartners: [], programsOffered: [] },
        serviceDetails: { tiers: [], claims: [] },
      },
      // TUNING 1: Raised concurrency safely to 3 threads with a lower minimum delay window
      limiter: new Bottleneck({
        maxConcurrent: 3,
        minTime: 250,
      }),
    };

    activeCrawls.set(domain, session);

    const emitEngineUpdate = (qSize) => {
      session.socket.emit("engine_state_update", {
        status: session.engineStatus,
        currentUrl: session.currentUrl,
        queueSize: qSize,
        pagesCrawled: session.pagesCrawledCount + session.extractedCount,
      });
    };

    const emitGroupedDataUpdate = (sess) => {
      try {
        const groupedData = groupDiscoveredLinks(sess.discoveredLinks);
        sess.socket.emit("crawl_data_grouped", {
          grouped: groupedData,
          dealershipProfile: sess.dealershipProfile,
        });
      } catch (err) {
        console.error(`Failed to group or emit discovery data updates: ${err.message}`);
      }
    };

    const calculateLiveInventoryMetrics = (sess) => {
      const products = sess.discoveredLinks.filter(l => l.category === 'product');
      let currentNew = 0;
      let currentUsed = 0;
      const brandCounts = {};
      const catCounts = {};

      products.forEach(p => {
        if (p.subCategory === 'new-product') currentNew++;
        if (p.subCategory === 'used-product') currentUsed++;
        if (p.brandName && p.brandName !== 'Unknown') brandCounts[p.brandName] = (brandCounts[p.brandName] || 0) + 1;
        if (p.vehicleType && p.vehicleType !== 'Unknown') catCounts[p.vehicleType] = (catCounts[p.vehicleType] || 0) + 1;
      });

      const currentTotal = currentNew + currentUsed;
      sess.dealershipProfile.inventoryMetrics = {
        newCount: currentNew,
        usedCount: currentUsed,
        newPercentage: currentTotal > 0 ? `${Math.round((currentNew / currentTotal) * 100)}%` : '0%',
        usedPercentage: currentTotal > 0 ? `${Math.round((currentUsed / currentTotal) * 100)}%` : '0%',
        topBrands: Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(b => b[0]),
        topCategories: Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(c => c[0])
      };
    };

    // =================================================================
    // PRE-FLIGHT: PLATFORM SNIFFER & API BYPASS
    // =================================================================
 
    session.socket.emit("crawl_status", {
      status: "processing",
      message: "Pre-flight: Sniffing platform architecture and sitemaps...",
      progress: 5,
    });

    // 1. Try to instantly seed the queue using the XML sitemap
    try {
      console.log(`[Sitemap] Attempting fast extraction for: ${rootUrl.origin}/sitemap.xml`);
      const sitemapUrls = await extractLinksFromSitemap(rootUrl.origin);
      
      if (sitemapUrls && sitemapUrls.length > 0) {
        sitemapUrls.forEach(urlStr => {
          const cleanUrl = canonicalizeUrl(urlStr);
          if (!session.seenUniqueLinks.has(cleanUrl)) {
            session.seenUniqueLinks.add(cleanUrl);
            
            const { category, subCategory } = getUrlCategoryAndSub(cleanUrl);
            
            // SPEED OPTIMIZATION: Only push directories/hubs into the discovery queue. 
            // Never push individual vehicle products into Phase 1 processing!
            if (category !== 'product') {
              session.queue.push({ url: cleanUrl, depth: 1 });
            }
            
            session.discoveredLinks.push({
              url: cleanUrl,
              text: '[Sitemap Link]',
              type: 'internal',
              category,
              subCategory,
              statusCode: 200,
              price: '',
              verificationStatus: category === 'product' ? 'missing' : 'not_applicable'
            });
          }
        });
      }
    } catch (sitemapErr) {
      console.warn(`[Sitemap] Fast discovery skipped or not found: ${sitemapErr.message}`);
    }

    // 2. Run existing API sniffer check
    const sniffResult = await sniffPlatformAPI(rootUrl.origin);
    if (sniffResult.platform !== "unknown" && sniffResult.rawData) {
      session.socket.emit("crawl_status", {
        status: "processing",
        message: `${sniffResult.platform.toUpperCase()} API detected! Bypassing WAF...`,
        progress: 80,
      });
      session.queue = [];
      session.extractionQueue = [];
      session.progress = 100;
    }

    
    // PHASE 1: SITE DISCOVERY LOOP
    // =================================================================
    while (session.queue.length > 0 && session.discoveredLinks.length < 10000) {
      if (session.isTerminated) break;
      if (session.isPaused) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const nextJob = session.queue.shift();
      if (!nextJob) continue;

      const currentTarget = nextJob.url;
      const currentDepth = nextJob.depth || 0;

      if (session.visitedUrls.has(currentTarget)) continue;

      session.visitedUrls.add(currentTarget);
      session.pagesCrawledCount++;
      session.currentUrl = currentTarget;
      session.engineStatus = "crawling";
      emitEngineUpdate(session.queue.length);

      try {
        // Wrapped with bottleneck scheduler context to obey throttling parameters smoothly
       const response = await session.limiter.schedule(() => fetchPage(currentTarget, session, rootUrl.origin));
        if (response && response.data) {
          
          // SPEED OPTIMIZATION: Only parse the profile if we don't have the main line yet
          // Since the footer is global, the first page (homepage) will extract 99% of this data safely.
          if (!session.dealershipProfile.telephoneMainLine || !session.dealershipProfile.telephoneFax) {
            console.log(`[Parser] Extracting profile metadata from hub page: ${currentTarget}`);
            const crawledProfile = extractDealershipProfile(response.data, currentTarget);

            Object.keys(crawledProfile).forEach((key) => {
              if (typeof crawledProfile[key] === "object" && crawledProfile[key] !== null && !Array.isArray(crawledProfile[key])) {
                Object.keys(crawledProfile[key]).forEach((subKey) => {
                  if (crawledProfile[key][subKey] && !session.dealershipProfile[key][subKey]) {
                    session.dealershipProfile[key][subKey] = crawledProfile[key][subKey];
                  }
                });
              } else {
                if (crawledProfile[key] && !session.dealershipProfile[key]) {
                  session.dealershipProfile[key] = crawledProfile[key];
                }
              }
            });
          }

          // Continue extracting links normally (this is still required to discover paths)
          parseAndExtractLinks(response.data, currentTarget, targetUrl, domain, session, currentDepth);
          
          calculateLiveInventoryMetrics(session);
          emitGroupedDataUpdate(session);
        }
      } catch (crawlErr) {
        console.error(`Skipping network path error on URL (${currentTarget}): ${crawlErr.message}`);
      }

      const totalKnownPages = session.visitedUrls.size + session.queue.length;
      const discoveryRatio = session.visitedUrls.size / Math.max(totalKnownPages, 1);
      session.progress = Math.min(5 + Math.round(discoveryRatio * 45), 50);

      session.socket.emit("crawl_status", {
        status: "processing",
        message: `Phase 1/2: Map discovery running (${session.discoveredLinks.length} links tracked)...`,
        progress: session.progress,
        linksFoundCount: session.discoveredLinks.length,
        pagesCrawled: session.pagesCrawledCount,
        queueSize: session.queue.length,
      });

      session.engineStatus = "idle";
      session.currentUrl = "";
    }

    // =================================================================
    // PHASE 2: DEEP PRICE EXTRACTION LOOP (Parallel Batch Injection)
    // =================================================================
    if (!session.isTerminated) {
      session.phase = "extraction";

      const productsFound = session.discoveredLinks.filter((link) => link.category === "product");
      session.extractionQueue = productsFound.map((link) => link.url);
      session.totalToExtract = session.extractionQueue.length;
      session.extractedCount = 0;

      session.socket.emit("crawl_status", {
        status: "processing",
        message: `Phase 2/2: Mapping profiles for ${session.totalToExtract} inventory assets...`,
        progress: 50,
        linksFoundCount: session.discoveredLinks.length,
        pagesCrawled: session.pagesCrawledCount,
        queueSize: session.totalToExtract,
      });

      const processProductPage = async (url) => {
        if (session.isTerminated) return;

        session.scannedIndex.add(url);
        session.extractedCount++;
        session.currentUrl = url;
        session.engineStatus = "crawling";
        emitEngineUpdate(session.extractionQueue.length);

        // Lowered natural crawl interval behavior using a compressed jitter gap
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 150) + 100));

        try {
          const response = await fetchPage(url, session, rootUrl.origin);
          if (response && response.data) {
            const meta = extractPageMetadata(response.data);
            const matchedRecord = session.discoveredLinks.find((link) => link.url === url);
            if (matchedRecord) {
              matchedRecord.price = meta.price || "";
              matchedRecord.verificationStatus = meta.price && matchedRecord.modelName ? "verified" : "missing";
            }
            calculateLiveInventoryMetrics(session);
            emitGroupedDataUpdate(session);
          }
        } catch (err) {
          console.error(`Asset data processing bypass on path (${url}): ${err.message}`);
        }

        session.progress = 50 + Math.min(Math.round((session.extractedCount / Math.max(session.totalToExtract, 1)) * 50), 50);

        session.socket.emit("crawl_status", {
          status: "processing",
          message: `Extracting vehicle records... (${session.extractedCount} / ${session.totalToExtract} complete)`,
          progress: session.progress,
          linksFoundCount: session.discoveredLinks.length,
          pagesCrawled: session.pagesCrawledCount + session.extractedCount,
          queueSize: session.extractionQueue.length,
        });

        session.engineStatus = "idle";
        session.currentUrl = "";
      };

      // TUNING 2: Splitting queue blocks into chunks of 3 parallel execution channels using a thread pool proxy
      const CONCURRENT_WORKERS_COUNT = 3;
      
      while (session.extractionQueue.length > 0 && !session.isTerminated) {
        if (session.isPaused) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }

        // Pull up to 3 URLs out of the array queue stack simultaneously
        const batch = [];
        for (let i = 0; i < CONCURRENT_WORKERS_COUNT; i++) {
          const url = session.extractionQueue.shift();
          if (url) batch.push(url);
        }

        if (batch.length === 0) break;

        // Process the current batch chunk in parallel across all worker nodes simultaneously
        await Promise.all(
          batch.map((url) => 
            session.limiter.schedule(() => processProductPage(url))
              .catch(err => console.error(`Batch child worker failure: ${err.message}`))
          )
        );
      }
    }

    // =================================================================
    // EXPORT TO GOOGLE SHEETS
    // =================================================================
    session.socket.emit("crawl_status", {
      status: "processing",
      message: "Formatting data and exporting to Google Sheets...",
      progress: 95,
      linksFoundCount: session.discoveredLinks.length,
      pagesCrawled: session.pagesCrawledCount + session.extractedCount,
      queueSize: 0,
    });

    try {
      const mappedData = mapCrawlerDataForSheets(session);
      const spreadsheetUrl = await createCrawlerReportWorkbook(domain, mappedData);
      console.log(`Export Complete! Report available at: ${spreadsheetUrl}`);
      session.socket.emit("report_ready", { url: spreadsheetUrl });
    } catch (sheetError) {
      console.error(`Google Sheets Export Failed: ${sheetError.message}`);
    }

    calculateLiveInventoryMetrics(session);
    emitGroupedDataUpdate(session);

    session.socket.emit("crawl_status", {
      status: session.isTerminated ? "failed" : "completed",
      message: session.isTerminated ? "Crawl run stopped manually." : "Process Complete! All items archived safely.",
      progress: 100,
      linksFoundCount: session.discoveredLinks.length,
      pagesCrawled: session.pagesCrawledCount + session.extractedCount,
      queueSize: 0,
    });
  } catch (error) {
    console.error(`Fatal core engine execution exception:`, error.message);
    if (socket) {
      socket.emit("crawl_status", {
        status: "failed",
        message: `An unexpected processing exception occurred: ${error.message}`,
        progress: 0,
      });
    }
  } finally {
    if (domain) {
      activeCrawls.delete(domain);
      console.log(`Cleaned up active session map context for domain identifier: ${domain}`);
    }
  }
};