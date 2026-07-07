// services/crawler/fetcher.js

import axios from 'axios';
import https from 'node:https';

export async function delegateFetchToClient(session, url) {
  return new Promise((resolve) => {
    // 🚨 FIX: Removed .connected check. As long as socket exists, we try the WAF bypass! 🚨
    if (!session || !session.socket) {
      console.warn(`[RevFetch] No socket available to delegate fetch for ${url}. Is the Extension UI open?`);
      return resolve({ data: '' });
    }

    const eventName = `client_fetch_response_${url}`;
    
    const handleResponse = (data) => {
      clearTimeout(timeout);
      resolve({ data: data.html });
    };

    console.log(`[RevFetch] Routing WAF blocked URL to Chrome Extension: ${url}`);
    session.socket.emit('request_client_fetch', { targetUrl: url });
    
    const timeout = setTimeout(() => {
      session.socket.removeListener(eventName, handleResponse);
      console.warn(`[RevFetch] Client delegation timed out for ${url}`);
      resolve({ data: '' });
    }, 15000);

    session.socket.once(eventName, handleResponse);
  });
}
export async function fetchPage(url, session = null) {
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
    
    if (response.data.includes('cf-browser-verification') || response.data.includes('Just a moment...')) {
        throw new Error('Cloudflare Challenge JS');
    }
    return { data: response.data };

  } catch (error) {
    const status = error.response ? error.response.status : null;
    const msg = error.message ? error.message.toLowerCase() : '';
    const isWafBlock = status === 403 || status === 401 || status === 503 || status === 406;
    
    if (isWafBlock || msg.includes('timeout') || msg.includes('cloudflare')) {
      console.log(`[Fetcher] WAF Block on ${url}. Triggering RevFetch native bridge...`);
      
      const revFetchRes = await delegateFetchToClient(session, url);
      
      if (revFetchRes && revFetchRes.data) {
        const lowerData = revFetchRes.data.toLowerCase();
        
        // CRITICAL FIX: Only reject if it explicitly contains the Cloudflare challenge template
        if (lowerData.includes('cf-browser-verification') || lowerData.includes('just a moment')) {
           console.error(`[RevFetch] 🚨 Cloudflare challenge page returned for ${url}.`);
           return { data: '' };
        }
        
        // If it's pristine XML/HTML, let it pass through seamlessly!
        return revFetchRes;
      }
    }

    if (status === 404) return { data: '' }; 
    console.error(`[Fetcher] Network error for ${url}: ${error.message}`);
    return { data: '' };
  }
}

export const fetchStealthPage = fetchPage;