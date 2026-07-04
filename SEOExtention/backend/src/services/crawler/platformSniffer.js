// services/crawler/platformSniffer.js

import * as cheerio from 'cheerio';
import { fetchPage } from './fetcher.js';

export async function sniffPlatformAPI(targetUrl) {
  try {
    const urlObj = new URL(targetUrl);
    const origin = urlObj.origin;

    console.log(`[Sniffer] Checking platform signature for ${origin} via secure fetch layer...`);

    // Fetch the page using our fast Tier 1 native request
    const response = await fetchPage(origin, null, origin, false);

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
    
    // 1. Extract all script sources and CSS links for CDN footprints
    const assetUrls = [];
    $('script[src]').each((_, el) => assetUrls.push($(el).attr('src').toLowerCase()));
    $('link[href]').each((_, el) => assetUrls.push($(el).attr('href').toLowerCase()));
    const assetString = assetUrls.join(' ');

    // 2. Extract Meta Tags
    const author = $('meta[name="author"]').attr('content')?.toLowerCase() || '';
    const generator = $('meta[name="generator"]').attr('content')?.toLowerCase() || '';

    // 3. Extract JSON-LD Schemas for deep data footprints
    let schemaString = '';
    $('script[type="application/ld+json"]').each((_, el) => {
      schemaString += $(el).html().toLowerCase();
    });

    // ==========================================
    // PLATFORM 1: DEALER SPIKE (Fixes DFW Honda)
    // ==========================================
    if (
      htmlLower.includes('dealer spike') ||
      assetString.includes('dealerspike.com') ||
      assetString.includes('cdn.dealerspike') ||
      author.includes('dealer spike') ||
      generator.includes('dealer spike') ||
      schemaString.includes('dealerspike.com')
    ) {
      console.log(`[Sniffer] Dealer Spike platform detected via deep heuristic scan!`);
      return { platform: 'dealer_spike', method: 'heuristic_scan', data: null };
    }

    // ==========================================
    // PLATFORM 2: DX1
    // ==========================================
    if (
      htmlLower.includes('powered by dx1') ||
      assetString.includes('dx1app.com') ||
      html.includes('DX1, LLC')
    ) {
      console.log(`[Sniffer] DX1 platform detected via deep heuristic scan!`);
      // Notice: The slow interceptInventoryAPI has been removed. 
      // The crawler will natively fly through DX1 until it actually hits a block.
      return { platform: 'dx1', method: 'heuristic_scan', data: null };
    }

    // ==========================================
    // PLATFORM 3: ARI NETWORK
    // ==========================================
    if (
      htmlLower.includes('ari network') ||
      assetString.includes('arinet.com') ||
      author.includes('ari network services') ||
      assetString.includes('ari-build')
    ) {
      console.log(`[Sniffer] ARI Network platform detected via deep heuristic scan!`);
      return { platform: 'ari', method: 'heuristic_scan', data: null };
    }

    // ==========================================
    // PLATFORM 4: INTERACT RV
    // ==========================================
    if (
      htmlLower.includes('interact rv') ||
      htmlLower.includes('interactrv') ||
      assetString.includes('interactrv.com') ||
      assetString.includes('cdn.interactrv')
    ) {
      console.log(`[Sniffer] Interact RV platform detected via deep heuristic scan!`);
      return { platform: 'interact_rv', method: 'heuristic_scan', data: null };
    }

    // ==========================================
    // PLATFORM 5: DEALER.COM
    // ==========================================
    if (
      htmlLower.includes('dealer.com') || 
      htmlLower.includes('ddc-content') ||
      assetString.includes('dealer.com')
    ) {
      console.log(`[Sniffer] Dealer.com platform detected via deep heuristic scan!`);
      return { platform: 'dealer.com', method: 'heuristic_scan', data: null };
    }

    // ==========================================
    // UNKNOWN PLATFORM
    // ==========================================
    console.log(`[Sniffer] Platform unknown or generic. Proceeding to normal crawl.`);
    return { platform: 'unknown', data: null };

  } catch (error) {
    console.log(`[Sniffer] Sniffing failed: ${error.message}`);
    return { platform: 'unknown', data: null };
  }
}