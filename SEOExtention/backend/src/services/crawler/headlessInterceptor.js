// services/crawler/headlessInterceptor.js

import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply stealth modifications to evade WAFs like Akamai and Cloudflare
chromium.use(stealthPlugin());

export async function interceptInventoryAPI(targetUrl) {
  let browser;
  try {
    console.log(`[Interceptor] Launching stealth browser for: ${targetUrl}`);
    // Launch headless. Set to false if you ever want to visually see what it's doing during debugging.
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let capturedData = null;

    // 1. Optimize Speed: Block heavy visual resources
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        route.abort(); // Block these to make the page load instantly
      } else {
        route.continue(); // Allow XHR, Fetch, and Scripts
      }
    });

    // 2. Listen to Network Traffic for the Golden JSON
    page.on('response', async (response) => {
      const url = response.url();
      
      // Look for API endpoints that typically serve inventory
      if (url.includes('/api/') && (url.includes('inventory') || url.includes('search') || url.includes('units'))) {
        const contentType = response.headers()['content-type'] || '';
        
        if (contentType.includes('application/json')) {
          try {
            const json = await response.json();
            // Validate it's actually an inventory payload and not a tiny config file
            if (json && (Array.isArray(json) || json.results || json.Inventory || json.vehicles || json.items || json.data)) {
              console.log(`[Interceptor] BINGO! Intercepted JSON payload from: ${url}`);
              capturedData = json;
            }
          } catch (e) {
            // Ignore partial or malformed streams
          }
        }
      }
    });

    // 3. Navigate to the target to trigger the API load
    const urlObj = new URL(targetUrl);
    // Navigating directly to /inventory usually forces the frontend to request the full list
    const inventoryUrl = `${urlObj.origin}/inventory`; 
    
    console.log(`[Interceptor] Navigating to ${inventoryUrl} to trigger data load...`);
    
    // We only wait for the DOM to load, not the heavy visual assets
    await page.goto(inventoryUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait just a brief moment for the internal React/Vue scripts to fire their API calls
    await page.waitForTimeout(3500);

    return capturedData;

  } catch (error) {
    console.error(`[Interceptor] Execution Error: ${error.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[Interceptor] Browser instance destroyed safely.`);
    }
  }
}