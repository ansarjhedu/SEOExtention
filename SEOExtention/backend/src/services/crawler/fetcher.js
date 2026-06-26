// services/crawler/fetcher.js
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';

// Global pool of clean browser fingerprints to disguise our cloud server signature
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/122.0'
];

export async function fetchPage(url, session, originUrl) {
  // 1. Establish the free Tor local proxy port agent connection link
  // Default Tor proxy port on Windows/Mac/Linux is 9050 (or 9150 if using Tor Browser bundle)
  const torProxyUrl = process.env.TOR_PROXY_URL || 'socks5h://127.0.0.1:9050';
  const agent = new SocksProxyAgent(torProxyUrl);

  // 2. Cycle a fresh browser fingerprint profile per network request
  const dynamicUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const config = {
    method: 'get',
    url: url,
    // Inject the SOCKS5 tunnel agent directly into the Axios engine
    httpAgent: agent,
    httpsAgent: agent,
    // Emulate organic human client headers explicitly
    headers: {
      'User-Agent': dynamicUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': originUrl || 'https://www.google.com/',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'no-cache'
    },
    // Give Tor a bit more network breathing room (15 seconds) to safely route over relays
    timeout: 15000 
  };

  return axios(config);
}