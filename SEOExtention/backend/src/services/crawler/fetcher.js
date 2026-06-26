// services/crawler/fetcher.js
import axios from 'axios';

// A rotating pool of real browser fingerprints to stop Cloudflare from spotting a pattern
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0'
];

const REFERERS = [
  'https://www.google.com/',
  'https://www.bing.com/',
  'https://www.yahoo.com/',
  'https://duckduckgo.com/'
];

export async function fetchPage(url, session, originUrl) {
  // 1. DYNAMIC JITTER BACKOFF: Inject a randomized artificial human delay (300ms - 800ms)
  // This breaks the robotic pattern that triggers firewall rate limits on cloud servers.
  const jitterDelay = Math.floor(Math.random() * 500) + 300;
  await new Promise(resolve => setTimeout(resolve, jitterDelay));

  // 2. Rotate a fresh User Agent and organic Referer per request
  const chosenUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const chosenReferer = REFERERS[Math.floor(Math.random() * REFERERS.length)];

  const config = {
    method: 'get',
    url: url,
    headers: {
      'User-Agent': chosenUA,
      // Hardcode common secure headers to convince firewalls this is a real browser window
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': url === originUrl ? chosenReferer : originUrl, // Use a search engine fallback if it's the homepage
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    },
    timeout: 10000 // 10 second network limit cap
  };

  return axios(config);
}