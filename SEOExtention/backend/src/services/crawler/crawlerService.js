// services/crawler/crawlerService.js

import Bottleneck from "bottleneck";
import { activeCrawls } from "./state.js";
import { getCleanDomain, canonicalizeUrl } from "./utils.js";
import { fetchPage, fetchStealthPage } from "./fetcher.js";
import { extractLinksFromSitemap } from "./sitemapExtractor.js";
import { sniffPlatformAPI } from "./platformSniffer.js";

// Import our routing engines
import * as defaultParser from "./parser.js";
import * as dxEngine from "./platforms/dxEngine.js";
import * as dSpikeEngine from "./platforms/dSpikeEngine.js";
import * as interactRvEngine from "./platforms/interactRvEngine.js";

// Import the grouper specifically from parser as it handles array formatting globally
import { groupDiscoveredLinks } from "./parser.js"; 

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

    // =================================================================
    // SYNCHRONIZED MASTER SESSION STATE (11-Tab Excel Compliant)
    // =================================================================
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
        // Sync: Added tiktok, linkedin
        socialLinks: { facebook: "", instagram: "", youtube: "", twitter: "", tiktok: "", linkedin: "" },
        requiredUrls: { parts: "", service: "", finance: "", bodyShop: "", careers: "" },
        // Sync: Added financeApp, partsDiagrams, warrantyRecall
        actionUrls: {
          serviceScheduler: "",
          partsRequest: "",
          tradeIn: "",
          testRide: "",
          staff: "",
          blog: "",
          events: "",
          testimonials: "",
          googleReviews: "",
          financeApp: "",
          partsDiagrams: "",
          warrantyRecall: ""
        }, 
        departmentPhones: { sales: "", service: "", parts: "" }, 
        storeHours: { monday: "", tuesday: "", wednesday: "", thursday: "", friday: "", saturday: "", sunday: "" },
        serviceHours: { monday: "", tuesday: "", wednesday: "", thursday: "", friday: "", saturday: "", sunday: "" },
        inventoryMetrics: { 
          newCount: 0, usedCount: 0, newPercentage: '0%', usedPercentage: '0%', topBrands: [], topCategories: [] 
        },
        // Sync: Master Spec Arrays & Booleans
        financeDetails: { lendingPartners: [], programsOffered: [], financingLanguage: "" },
        serviceDetails: { tiers: [], claims: [], brandsServiced: [], nonFranchiseAccepted: false, unitAgeLimitations: "" },
        partsDetails: { oemSupport: false, aftermarketSupport: false, specialOrders: false },
        bodyShopDetails: { servicesOffered: [], paintServices: false }
      },
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
      message: "Pre-flight: Sniffing platform architecture...",
      progress: 5,
    });

    const sniffResult = await sniffPlatformAPI(rootUrl.origin, session);

    // DYNAMIC ENGINE ROUTING LOGIC
    let activeEngine;
    let activeFetcher = fetchPage;

    if (sniffResult.platform === 'dx1') {
      console.log(`[Router] Routing to dxEngine`);
      activeEngine = dxEngine;
      activeFetcher = fetchPage;
    } else if (sniffResult.platform === 'dealer_spike') {
      console.log(`[Router] Routing to dSpikeEngine`);
      activeEngine = dSpikeEngine;
      activeFetcher = fetchStealthPage; 
    } else if (sniffResult.platform === 'interact_rv') {
      console.log(`[Router] Routing to interactRvEngine`);
      activeEngine = interactRvEngine;
      activeFetcher = fetchStealthPage; 
    } else {
      console.log(`[Router] Routing to defaultParser`);
      activeEngine = defaultParser;
      activeFetcher = fetchPage; 
    }

    session.dealershipProfile.platform = sniffResult.platform === 'unknown' ? 'Unknown' : sniffResult.platform.toUpperCase();

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

    // =================================================================
    // SITEMAP SEEDING LAYER (Smart Routing for Maximum Speed)
    // =================================================================
    if (!session.isTerminated) {
      try {
        session.socket.emit("crawl_status", {
          status: "processing",
          message: "Extracting site blueprint from sitemaps...",
          progress: 8,
        });

        const sitemapLinks = await extractLinksFromSitemap(targetUrl, session);
        const safeLinks = sitemapLinks || [];
        console.log(`[Crawler] Categorizing and seeding ${safeLinks.length} items from sitemap...`);
        
        // DEALER SPIKE FALLBACK DETECTION
        if (session.dealershipProfile.platform === 'Unknown' || session.dealershipProfile.platform === 'UNKNOWN') {
          const sitemapString = safeLinks.join(' ').toLowerCase();
          if (sitemapString.includes('xnewinventory') || sitemapString.includes('sitemapinventory.xml') || sitemapString.includes('page=xsitemap')) {
            console.log(`[Router] 🚨 FALLBACK ACTIVATED: Dealer Spike sitemap signatures detected! Switching engine dynamically...`);
            activeEngine = dSpikeEngine;
            session.dealershipProfile.platform = 'DEALER_SPIKE';
          }
        }

        for (const url of safeLinks) {
          if (!session.seenUniqueLinks.has(url)) {
            session.seenUniqueLinks.add(url);
            
            const { category, subCategory } = activeEngine.categorizeLink(url);
            
            session.discoveredLinks.push({
              url: url,
              text: '[Sitemap Link]',
              type: 'internal',
              category: category,
              subCategory: subCategory,
              statusCode: 200,
              price: '',
              verificationStatus: (category === 'product' || category === 'Vehicle Products' || category === 'Inventory Collection') ? 'MISSING' : 'VERIFIED'
            });

            if (category !== 'product' && category !== 'Vehicle Products') {
              session.queue.push({ url, depth: 1 });
            }
          }
        }
      } catch (sitemapError) {
        console.error(`[Crawler] Sitemap seeding bypassed: ${sitemapError.message}`);
      }
    }

    // =================================================================
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
        const response = await session.limiter.schedule(() => activeFetcher(currentTarget, session, rootUrl.origin));
        if (response && response.data) {
          
          const crawledProfile = activeEngine.extractDealershipProfile(response.data, currentTarget);

          // Deep Merge for extracted objects vs primitives safely
         // Deep Merge for extracted objects, arrays, and primitives safely
          Object.keys(crawledProfile).forEach((key) => {
            if (typeof crawledProfile[key] === "object" && crawledProfile[key] !== null && !Array.isArray(crawledProfile[key])) {
              Object.keys(crawledProfile[key]).forEach((subKey) => {
                
                // NEW: If the subKey is an array (like lendingPartners or claims), combine them!
                if (Array.isArray(crawledProfile[key][subKey])) {
                  if (!session.dealershipProfile[key][subKey]) session.dealershipProfile[key][subKey] = [];
                  crawledProfile[key][subKey].forEach(item => {
                    if (!session.dealershipProfile[key][subKey].includes(item)) {
                      session.dealershipProfile[key][subKey].push(item);
                    }
                  });
                } 
                // NEW: If the subKey is a boolean (like oemSupport), switch it to true if found
                else if (typeof crawledProfile[key][subKey] === "boolean") {
                   if (crawledProfile[key][subKey] === true) {
                     session.dealershipProfile[key][subKey] = true;
                   }
                } 
                // Standard string handling
                else if (crawledProfile[key][subKey] && !session.dealershipProfile[key][subKey]) {
                  session.dealershipProfile[key][subKey] = crawledProfile[key][subKey];
                }
              });
            } else {
              if (crawledProfile[key] && !session.dealershipProfile[key]) {
                session.dealershipProfile[key] = crawledProfile[key];
              }
            }
          });

          activeEngine.parseAndExtractLinks(response.data, currentTarget, targetUrl, domain, session, currentDepth);
          
          calculateLiveInventoryMetrics(session);
          emitGroupedDataUpdate(session);
        }
      } catch (crawlErr) {
        if (crawlErr.message.includes('404') || crawlErr.status === 404) {
          const matched = session.discoveredLinks.find(l => l.url === currentTarget);
          if (matched) {
            matched.category = 'dead_link';
            matched.subCategory = 'error';
            matched.statusCode = 404;
            matched.text = '[Dead Link - 404]';
          } else {
            session.discoveredLinks.push({
              url: currentTarget, text: '[Dead Link - 404]', type: 'internal', 
              category: 'dead_link', subCategory: 'error', statusCode: 404, price: ''
            });
          }
        } else {
          console.error(`Skipping network path error on URL (${currentTarget}): ${crawlErr.message}`);
        }
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

        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 150) + 100));

        try {
          const response = await activeFetcher(url, session, rootUrl.origin);
          if (response && response.data) {
            
            const meta = activeEngine.extractPageMetadata(response.data);
            
           const matchedRecord = session.discoveredLinks.find((link) => link.url === url);
            if (matchedRecord) {
              matchedRecord.price = meta.price || "";
              matchedRecord.priceType = meta.priceType || "";
              matchedRecord.msrp = meta.msrp || "";
              matchedRecord.retailPrice = meta.retailPrice || ""; // 🚨 NEW
              matchedRecord.salePrice = meta.salePrice || "";
              matchedRecord.sellingPrice = meta.sellingPrice || ""; // 🚨 NEW
              matchedRecord.monthlyPayment = meta.monthlyPayment || "";
              matchedRecord.specs = meta.specs || "";
              matchedRecord.metaDescription = meta.metaDescription || "";
              
              if (!matchedRecord.year && meta.year) matchedRecord.year = meta.year;
              if (!matchedRecord.brandName && meta.brandName) matchedRecord.brandName = meta.brandName;
              
              if (!matchedRecord.modelName) {
                  if (meta.modelName) matchedRecord.modelName = meta.modelName;
                  else if (matchedRecord.text && matchedRecord.text !== '[Sitemap Link]') matchedRecord.modelName = matchedRecord.text;
              }

              if (matchedRecord.vehicleType === 'Vehicle' && meta.vehicleType) matchedRecord.vehicleType = meta.vehicleType;
              matchedRecord.verificationStatus = matchedRecord.price || matchedRecord.modelName ? "VERIFIED" : "MISSING";
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

      const CONCURRENT_WORKERS_COUNT = 3;
      
      while (session.extractionQueue.length > 0 && !session.isTerminated) {
        if (session.isPaused) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }

        const batch = [];
        for (let i = 0; i < CONCURRENT_WORKERS_COUNT; i++) {
          const url = session.extractionQueue.shift();
          if (url) batch.push(url);
        }

        if (batch.length === 0) break;

        await Promise.all(
          batch.map((url) => 
            session.limiter.schedule(() => processProductPage(url))
              .catch(err => console.error(`Batch child worker failure: ${err.message}`))
          )
        );
      }
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