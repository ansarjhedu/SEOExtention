// background.js

chrome.runtime.onInstalled.addListener(() => {
  console.log("MaxOpp aiSEO Extension installed and active.");
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// ============================================================================
// NATIVE CHROME TAB BYPASS
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "trigger_revfetch") {
    console.log(`[Background] Initiating In-Tab WAF Bypass for: ${request.url}`);

    const urlObj = new URL(request.url);
    const baseDomain = urlObj.hostname.replace(/^www\./, '');

    chrome.tabs.query({ url: `*://*.${baseDomain}/*` }, (tabs) => {
      if (tabs.length > 0) {
        const targetTab = tabs[0]; 

        console.log(`[Background] Found active tab for ${baseDomain}. Injecting native fetch...`);

        chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: async (fetchUrl) => {
            try {
              // Reverted to the simple, proven fetch headers that Cloudflare accepts
              const res = await fetch(fetchUrl, {
                headers: { 'Accept': 'application/xml, text/xml, text/html, */*' }
              });
              return await res.text();
            } catch (err) {
              return "";
            }
          },
          args: [request.url]
        }, (results) => {
          if (results && results[0] && results[0].result) {
            console.log(`[Background] Success! Ripped ${results[0].result.length} bytes from ${request.url}`);
            chrome.runtime.sendMessage({
              action: "revfetch_success",
              url: request.url,
              html: results[0].result
            });
          }
        });
      } else {
        console.error(`[Background] No open tab found for ${baseDomain} to execute bypass.`);
      }
    });
  }
});