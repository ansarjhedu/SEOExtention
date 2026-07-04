// services/crawler/fetcher.js

import axios from 'axios';
import https from 'node:https';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

// Initialize the stealth plugin to hide headless signatures from Cloudflare
chromium.use(stealthPlugin());

// SINGLETON BROWSER: Prevents RAM crashes and speeds up fallback by 500%
let globalBrowser = null;

async function getBrowser() {
  if (!globalBrowser) {
    console.log('[Playwright] Initializing shared stealth browser instance...');
    globalBrowser = await chromium.launch({
      headless: true, // Keep true for server execution
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
  }
  return globalBrowser;
}

/**
 * Executes a fast native request. If Cloudflare blocks it (403/503/Drops), 
 * it automatically falls back to a stealthy headless browser to bypass the WAF locally.
 */
export async function fetchPage(url, session, origin = '', renderJs = false) {
  // Tier 1: Fast, free native Axios request
 try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'close' // Forces the socket to close immediately, freeing up Node's network pool faster
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 8000 // Tighter timeout so we fail over to stealth faster if blocked
    });
    
    // Check if Cloudflare let us through but served a JS challenge page instead of the real HTML
    if (response.data.includes('cf-browser-verification') || response.data.includes('Just a moment...')) {
      throw new Error('Cloudflare Challenge JS');
    }

    return { data: response.data };

  } catch (error) {
    const status = error.response ? error.response.status : null;
    const msg = error.message.toLowerCase();
    
    const isWafBlock = status === 403 || status === 401 || status === 503 || status === 406;
    const isNetworkDrop = msg.includes('econnreset') || msg.includes('socket hang up') || msg.includes('timeout');

    if (isWafBlock || isNetworkDrop || msg.includes('cloudflare')) {
      console.log(`[Fetcher] WAF/Network block on ${url} (Status: ${status || 'Drop'}). Triggering Stealth Browser...`);
      return await fetchWithStealthPlaywright(url);
    }

    // CRITICAL FIX: Handle 404s gracefully without crashing the crawler
    if (status === 404) {
      console.log(`[Fetcher] Skipping dead link (404 Not Found): ${url}`);
      return { data: '' }; // Return empty data so the crawler skips it safely
    }

    // For other weird network errors, throw normally
    console.error(`[Fetcher] Native request failed for ${url}: ${error.message}`);
    throw error;
  }
}

/**
 * Tier 2: Local Stealth Headless Browser Fallback
 * Opens a lightweight tab in the shared browser to bypass challenges instantly.
 */
async function fetchWithStealthPlaywright(url) {
  const browser = await getBrowser();
  let context, page;

  try {
    // Open a fresh context (like an incognito window) for clean cookies
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
    
    page = await context.newPage();

    // Route out unnecessary assets to save bandwidth and speed up the WAF bypass
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Use domcontentloaded to speed up extraction (don't wait for all network requests)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    
    // Buffer to ensure Cloudflare JS challenges and dynamic grids have loaded
    await page.waitForTimeout(2500); 

    const html = await page.content();
    
    // Cleanup the lightweight tab
    await page.close();
    await context.close();
    
    return { data: html };

  } catch (pwError) {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    console.error(`[Playwright] Stealth fallback failed for ${url}: ${pwError.message}`);
    throw pwError;
  }
}