// Listener to handle requests from the React Side Panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract_links") {
    try {
      const links = parseDOMForLinks();
      sendResponse({ status: "success", data: links });
    } catch (error) {
      sendResponse({ status: "error", message: error.message });
    }
  }
  return true; // Keeps the message channel open for asynchronous responses
});

function parseDOMForLinks() {
  const anchors = Array.from(document.querySelectorAll("a"));
  const currentOrigin = window.location.origin;
  const extracted = [];
  const seenUrls = new Set();

  anchors.forEach((anchor) => {
    let href = anchor.getAttribute("href");
    if (!href) return;

    try {
      // 1. Resolve relative paths into absolute URLs
      const absoluteUrl = new URL(href, currentOrigin);

      // 2. Normalize: Remove URL hash fragments (e.g., #reviews) and common tracking parameters
      absoluteUrl.hash = "";
      const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
      trackingParams.forEach((param) => absoluteUrl.searchParams.delete(param));

      const cleanUrl = absoluteUrl.toString();

      // 3. De-duplicate inside the current scan
      if (seenUrls.has(cleanUrl)) return;
      seenUrls.add(cleanUrl);

      // 4. Determine Link Type (Internal vs External)
      const isInternal = absoluteUrl.origin === currentOrigin;

      // 5. Gather Anchor Text safely
      let anchorText = anchor.textContent.trim();
      if (!anchorText) {
        // Fallback to image alt text inside the link if text is empty
        const innerImg = anchor.querySelector("img");
        anchorText = innerImg ? innerImg.getAttribute("alt")?.trim() || "[Image Link]" : "[No Link Text]";
      }

      extracted.push({
        url: cleanUrl,
        text: anchorText,
        type: isInternal ? "internal" : "external"
      });
    } catch (e) {
      // Ignore malformed URLs (like javascript:void(0) or tel: protocols)
    }
  });

  return extracted;
}