// services/crawler/fetcher.js
import axios from 'axios';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

// In-memory cache for free public proxies to prevent rescraping on every single request
let cachedPublicProxies = [];

async function refreshFreeProxies() {
  try {
    // Fetch a fresh list of free public proxies anonymously
    const res = await axios.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=2000&country=US&ssl=all&anonymity=all', { timeout: 5000 });
    if (res.data && typeof res.data === 'string') {
      cachedPublicProxies = res.data.split('\r\n').filter(p => p.includes(':'));
      console.log(`[Proxy Engine] Successfully loaded ${cachedPublicProxies.length} free public fallback proxies.`);
    }
  } catch (e) {
    console.error('[Proxy Engine] Failed to harvest free proxies:', e.message);
  }
}

export async function fetchPage(url, session, originUrl) {
  const chosenUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  
  const baseConfig = {
    method: 'get',
    url: url,
    headers: {
      'User-Agent': chosenUA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': originUrl || 'https://www.google.com/',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    timeout: 7000
  };

  try {
    // 1. Attempt a standard clean direct fetch first
    return await axios(baseConfig);
  } catch (error) {
    // 2. If blocked by a 403 Forbidden firewall, trigger the free proxy recovery fallback
    if (error.response && error.response.status === 403) {
      console.warn(`[Firewall] 403 Blocked on ${url}. Activating free proxy bypass...`);
      
      if (cachedPublicProxies.length === 0) {
        await refreshFreeProxies();
      }

      // Try up to 5 different free proxies from the pool before throwing an error
      for (let i = 0; i < Math.min(5, cachedPublicProxies.length); i++) {
        const proxyStr = cachedPublicProxies[Math.floor(Math.random() * cachedPublicProxies.length)];
        const [host, port] = proxyStr.split(':');
        
        console.log(`[Proxy Loop] Rerouting request via free node: http://${host}:${port}`);
        
        try {
          const proxyConfig = {
            ...baseConfig,
            timeout: 9000, // Extra headroom for public proxy latency
            proxy: {
              protocol: 'http',
              host: host,
              port: parseInt(port, 10)
            }
          };
          return await axios(proxyConfig);
        } catch (proxyError) {
          console.log(`[Proxy Loop] Node http://${host}:${port} failed, trying next...`);
        }
      }
    }
    
    // If all fail or error wasn't a 403, pass the original exception up
    throw error;
  }
}