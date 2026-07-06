// services/crawler/fetcher.js

import axios from 'axios';
import https from 'node:https';
import { gotScraping } from 'got-scraping';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createCursor } from 'ghost-cursor';
import { ScrapingBrowser } from '@zenrows/browser-sdk';

chromium.use(stealthPlugin());

let globalBrowser = null;
const domainCookies = new Map();

// MEMORY: Remembers if a domain requires ZenRows so we don't waste time failing Tier 1 & 2
const globalWafEscalations = new Map(); 

async function getBrowser() {
  if (!globalBrowser) {
    console.log('[Playwright] Initializing shared stealth browser instance...');
    globalBrowser = await chromium.launch({
      headless: true, 
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled',
        '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process', '--window-size=1920,1080'
      ]
    });
  }
  return globalBrowser;
}

// ============================================================================
// 1. STANDARD NATIVE FETCHER (For DX1 & Generic Sites)
// ============================================================================
export async function fetchPage(url, session = null, origin = '', renderJs = false) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'close' 
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 8000 
    });
    
    if (response.data.includes('cf-browser-verification') || response.data.includes('Just a moment...')) throw new Error('Cloudflare Challenge JS');
    return { data: response.data };

  } catch (error) {
    const status = error.response ? error.response.status : null;
    const msg = error.message.toLowerCase();
    const isWafBlock = status === 403 || status === 401 || status === 503 || status === 406;
    
    if (isWafBlock || msg.includes('timeout') || msg.includes('cloudflare')) {
      console.log(`[Fetcher - Standard] WAF block on ${url}. Attempting basic Playwright...`);
      return await fetchWithStealthPlaywright(url);
    }

    if (status === 404) return { data: '' }; 
    throw error;
  }
}

async function fetchWithStealthPlaywright(url) {
  const browser = await getBrowser();
  let context, page;
  try {
    context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' });
    page = await context.newPage();
    await page.route('**/*', route => { ['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType()) ? route.abort() : route.continue(); });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000); 

    const html = await page.content();
    await page.close(); await context.close();
    
    if (html.includes('cf-browser-verification') || html.includes('Just a moment') || html.includes('Access denied')) {
       throw new Error('WAF_BLOCK_PERSISTS');
    }
    return { data: html };
  } catch (pwError) {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    throw pwError;
  }
}

// ============================================================================
// 2. HEAVY ANTI-BOT FETCHER (Dealer Spike, Interact RV & ARI)
// ============================================================================
export async function fetchStealthPage(url, session = null, targetDomain = '') {
  if (session && session.isTerminated) throw new Error('Crawl terminated by user.');

  // CRITICAL FIX: Absolute domain normalization for WAF Memory mapping
  let domainKey = 'unknown';
  try { domainKey = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}

  // ESCALATION MEMORY: If we already know this domain requires ZenRows, skip Tiers 1 & 2 immediately!
  if (globalWafEscalations.get(domainKey) === 'ZENROWS') {
    return await fetchWithZenRowsUltimateFallback(url, session);
  }

  // Tier 1: Advanced Headed Request Simulation
  try {
    const options = {
      url: url,
      headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 110 }], devices: ['desktop'], locales: ['en-US'], operatingSystems: ['windows', 'macos'] },
      timeout: { request: 8000 }, retry: { limit: 0 } 
    };

    if (domainCookies.has(domainKey)) options.headers = { 'Cookie': domainCookies.get(domainKey) };
    const response = await gotScraping(options);
    
    if (response.body.includes('cf-browser-verification') || response.body.includes('Just a moment...')) throw new Error('Cloudflare Challenge JS');
    return { data: response.body };

  } catch (error) {
    if (session && session.isTerminated) throw new Error('Crawl terminated by user.');
    const status = error.response ? error.response.statusCode : null;
    const msg = error.message.toLowerCase();
    
    if (status === 403 || status === 401 || status === 503 || status === 406 || msg.includes('challenge') || msg.includes('cloudflare') || msg.includes('timeout')) {
      console.log(`[Fetcher - Heavy] Security block on ${url}. Escalating to Ghost Cursor...`);
      
      try {
        return await executePlaywrightGhostStealth(url, domainKey, session);
      } catch (tier2Error) {
        // TIER 3 ULTIMATE FALLBACK: ZENROWS
        if (tier2Error.message.includes('WAF_BLOCK_PERSISTS') || tier2Error.message.includes('timeout')) {
            console.log(`[ZenRows] Ghost Cursor defeated. Locking domain [${domainKey}] to ZenRows & escalating...`);
            
            // SAVE TO MEMORY: We will never try Ghost Cursor on this domain again for this session.
            globalWafEscalations.set(domainKey, 'ZENROWS');
            
            return await fetchWithZenRowsUltimateFallback(url, session);
        }
        throw tier2Error;
      }
    }
    if (status === 404) return { data: '' }; 
    throw error;
  }
}

// ----------------------------------------------------------------------------
// TIER 2: PLAYWRIGHT GHOST CURSOR (Offset targeting + Faster failover)
// ----------------------------------------------------------------------------
async function executePlaywrightGhostStealth(url, domainKey, session) {
  const browser = await getBrowser();
  let context, page;

  try {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false });
    page = await context.newPage();

    await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const cursor = createCursor(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    let pageText = await page.content();
    let pageTitle = await page.title();

    if (pageText.includes('cf-browser-verification') || pageTitle.includes('Just a moment') || pageText.includes('Verify you are human') || pageText.includes('Access denied')) {
      console.log(`[Playwright] Cloudflare challenge detected. Solving with Ghost Cursor...`);
      const startTime = Date.now();
      
      // TIGHTENED LOOP: Only wait 12 seconds. If Turnstile doesn't pass quickly, local IP is likely banned.
      while (Date.now() - startTime < 12000) {
        if (session && session.isTerminated) throw new Error('Crawl terminated by user.');
        await page.waitForTimeout(1000); 
        pageText = await page.content();
        pageTitle = await page.title();
        
        if (!pageText.includes('cf-browser-verification') && !pageTitle.includes('Just a moment') && !pageText.includes('Verify you are human') && !pageText.includes('Access denied')) {
          console.log(`[Playwright] Cloudflare challenge solved successfully!`); break;
        }

        try {
          const frames = page.frames();
          for (const frame of frames) {
            if (frame.url().includes('cloudflare') || frame.url().includes('turnstile')) {
              const frameElement = await frame.frameElement();
              await frameElement.scrollIntoViewIfNeeded().catch(() => {});
              const box = await frameElement.boundingBox();
              
              if (box && box.width > 0 && box.height > 0) {
                // STRONG LOGIC: Cloudflare checkbox is on the left side. Hitting dead center often fails.
                const targetX = box.x + 30 + (Math.random() * 10); 
                const targetY = box.y + (box.height / 2) + (Math.random() * 5);
                
                await page.waitForTimeout(Math.random() * 1000 + 800); // Wait like a human reading
                await cursor.moveTo({ x: targetX, y: targetY });
                await page.waitForTimeout(Math.random() * 500 + 200); 
                await cursor.click();
              }
            }
          }
        } catch (clickErr) {}
      }
      
      // If we are still blocked after 12 seconds, throw error to trigger ZenRows
      if (pageText.includes('cf-browser-verification') || pageTitle.includes('Just a moment') || pageText.includes('Access denied')) {
         throw new Error('WAF_BLOCK_PERSISTS'); 
      }
    }

    if (session && session.isTerminated) throw new Error('Crawl terminated by user.');
    const cookies = await context.cookies();
    if (cookies.length > 0) domainCookies.set(domainKey, cookies.map(c => `${c.name}=${c.value}`).join('; '));

    let html;
    if (url.toLowerCase().includes('.xml')) {
      try { html = await page.evaluate(async (reqUrl) => { const res = await fetch(reqUrl); return await res.text(); }, url); } 
      catch (e) { html = await page.content(); }
    } else {
      html = await page.content();
    }
    
    await page.close(); await context.close(); return { data: html };
  } catch (pwError) {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    throw pwError;
  }
}

// ============================================================================
// 3. ULTIMATE ZENROWS API FALLBACK (Tier 3)
// ============================================================================
async function fetchWithZenRowsUltimateFallback(url, session) {
  if (session && session.isTerminated) throw new Error('Crawl terminated by user.');

  const apiKey = process.env.ZENROWS_API_KEY || '124edfaa2c5996206cf54f9812f392bbbb6c6de3';
  const scrapingBrowser = new ScrapingBrowser({ apiKey });
  
  let browser;
  try {
    const { chromium: nativeChromium } = await import('playwright');
    browser = await nativeChromium.connectOverCDP(scrapingBrowser.getConnectURL());
    const page = await browser.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500); 

    let html = await page.content();

    // Clean XML wrappers injected by Chrome CDP
    if (url.toLowerCase().includes('.xml')) {
      const $ = await import('cheerio').then(ch => ch.load(html));
      const preText = $('pre').text();
      if (preText) html = preText;
    }

    console.log(`[ZenRows] Successfully fetched unblocked content for ${url}`);
    return { data: html };

  } catch (error) {
    console.error(`[ZenRows Error] Total failure to bypass WAF for ${url}: ${error.message}`);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}