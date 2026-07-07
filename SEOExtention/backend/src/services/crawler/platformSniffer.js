// services/crawler/platformSniffer.js

import * as cheerio from 'cheerio';
import { fetchPage } from './fetcher.js';

export async function sniffPlatformAPI(targetUrl, session) {
  try {
    const urlObj = new URL(targetUrl);
    const origin = urlObj.origin;

    console.log(`[Sniffer] Checking platform signature for ${origin} via RevFetch layer...`);

    // PASS SESSION INSTEAD OF NULL
    const response = await fetchPage(origin, session);

    if (!response || !response.data) {
      console.log(`[Sniffer] Pre-flight fetch returned empty payload. Proceeding as unknown.`);
      return { platform: 'unknown', data: null };
    }

    const html = response.data;
    const htmlLower = html.toLowerCase();
    const $ = cheerio.load(html);

    // =================================================================
    // HEURISTIC EXTRACTION: Gather hidden footprints from the DOM
    // =================================================================
    const assetUrls = [];
    $('script[src]').each((_, el) => assetUrls.push($(el).attr('src').toLowerCase()));
    $('link[href]').each((_, el) => assetUrls.push($(el).attr('href').toLowerCase()));
    const assetString = assetUrls.join(' ');

    const author = $('meta[name="author"]').attr('content')?.toLowerCase() || '';
    const generator = $('meta[name="generator"]').attr('content')?.toLowerCase() || '';

    let schemaString = '';
    $('script[type="application/ld+json"]').each((_, el) => {
      schemaString += $(el).html().toLowerCase();
    });

    let linkString = '';
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) linkString += href.toLowerCase() + ' ';
    });

    // PLATFORM 1: DEALER SPIKE
    if (
      htmlLower.includes('dealer spike') ||
      assetString.includes('dealerspike.com') ||
      assetString.includes('cdn.powersportsnetwork.com') || 
      assetString.includes('cdn.psndealer.com') ||          
      assetString.includes('cdn.netmotorcycles.com') ||
      htmlLower.includes('ds-wrapper') ||                  
      htmlLower.includes('data-inventory-id') ||            
      author.includes('dealer spike') ||
      generator.includes('dealer spike') ||
      schemaString.includes('dealerspike.com') ||
      linkString.includes('xnewinventory') || 
      linkString.includes('xpreownedinventory') ||       
      linkString.includes('/search/inventory')              
    ) {
      console.log(`[Sniffer] Dealer Spike platform detected via deep heuristic scan!`);
      return { platform: 'dealer_spike', method: 'heuristic_scan', data: null };
    }

    // PLATFORM 2: DX1
    if (
      htmlLower.includes('powered by dx1') ||
      assetString.includes('dx1app.com') ||
      htmlLower.includes('dx1, llc') ||  
      htmlLower.includes('dx1')          
    ) {
      console.log(`[Sniffer] DX1 platform detected via deep heuristic scan!`);
      return { platform: 'dx1', method: 'heuristic_scan', data: null };
    }

    // PLATFORM 3: ARI NETWORK
    if (
      htmlLower.includes('ari network') ||
      assetString.includes('arinet.com') ||
      author.includes('ari network services') ||
      assetString.includes('ari-build') ||
      linkString.includes('arinet.com') ||
      linkString.includes('partstream')
    ) {
      console.log(`[Sniffer] ARI Network platform detected via deep heuristic scan!`);
      return { platform: 'ari', method: 'heuristic_scan', data: null };
    }

    // PLATFORM 4: INTERACT RV
    if (
      htmlLower.includes('interact rv') ||
      htmlLower.includes('interactrv') ||
      assetString.includes('interactrv.com') ||
      assetString.includes('cdn.interactrv') ||
      author.includes('interactrv')
    ) {
      console.log(`[Sniffer] Interact RV platform detected via deep heuristic scan!`);
      return { platform: 'interact_rv', method: 'heuristic_scan', data: null };
    }
    
    // PLATFORM 5: DEALER.COM
    if (
      htmlLower.includes('dealer.com') || 
      htmlLower.includes('ddc-content') ||
      assetString.includes('dealer.com')
    ) {
      console.log(`[Sniffer] Dealer.com platform detected via deep heuristic scan!`);
      return { platform: 'dealer.com', method: 'heuristic_scan', data: null };
    }

    console.log(`[Sniffer] Platform unknown or generic. Proceeding to normal crawl.`);
    return { platform: 'unknown', data: null };

  } catch (error) {
    console.log(`[Sniffer] Sniffing failed: ${error.message}`);
    return { platform: 'unknown', data: null };
  }
}