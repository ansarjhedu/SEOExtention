// services/crawler/platformSniffer.js

import axios from 'axios';
import https from 'node:https';
import { interceptInventoryAPI } from './headlessInterceptor.js';

export async function sniffPlatformAPI(targetUrl) {
  try {
    const urlObj = new URL(targetUrl);
    const origin = urlObj.origin;

    console.log(`[Sniffer] Checking platform signature for ${origin}...`);

    // 1. Fetch homepage to grab cookies and platform signature
    const response = await axios.get(origin, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 10000
    });

    const html = response.data;
    
    // ==========================================
    // PLATFORM 1: DEALER.COM
    // ==========================================
    const isDealerCom = html.includes('Dealer.com') || html.includes('ddc-content');
    if (isDealerCom) {
      console.log(`[Sniffer] Dealer.com platform detected!`);
      const preloadedStateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});/);
      
      if (preloadedStateMatch && preloadedStateMatch[1]) {
        return { platform: 'dealer.com', method: 'preloaded_state', rawData: JSON.parse(preloadedStateMatch[1]) };
      }
      
      const apiUrl = `${origin}/apis/render/inventory/search`;
      try {
        const apiResponse = await axios.get(apiUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
        return { platform: 'dealer.com', method: 'api_endpoint', rawData: apiResponse.data };
      } catch (e) {
        return { platform: 'dealer.com', method: 'failed', data: null };
      }
    }

    // ==========================================
    // PLATFORM 2: DX1 (Texas Motor Sports)
    // ==========================================
    const isDX1 = html.includes('DX1, LLC') || html.includes('dx1app.com');
    if (isDX1) {
      console.log(`[Sniffer] DX1 platform detected! Bypassing WAF with Playwright Network Interceptor...`);
      
      const interceptedData = await interceptInventoryAPI(origin);
      
      if (interceptedData) {
        return { platform: 'dx1', method: 'playwright_interception', rawData: interceptedData };
      }
      
      console.log(`[Sniffer] Interceptor missed the JSON. Raw HTML extraction required.`);
      return { platform: 'dx1', method: 'failed', data: null };
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