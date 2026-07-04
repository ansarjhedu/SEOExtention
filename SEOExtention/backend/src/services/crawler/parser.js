// services/crawler/parser.js

import * as cheerio from 'cheerio';
import { getCleanDomain, isAssetUrl, getUrlCategoryAndSub, extractAutoDetailsFromUrl, canonicalizeUrl } from './utils.js';

export function isCrawlablePath(urlStr, currentDepth = 0) {
  if (currentDepth >= 4) return false;

  const lowerUrl = urlStr.toLowerCase();
  
  const blacklistDirectories = [
    '/event', '/calendar', '/news', '/gallery', '/review', '/testimonial', 
    '/social', '/widget', '/blog', '/article', '/post', '/tag', '/category/blog',
    '/forum', '/job', '/career', '/employment', '/join-our-team',
    '/oemparts', '/fiche', '/microfiche', '/parts/search', '/partsfinder', 
    '/arinet', '/cart', '/checkout', '/account', '/shop/category',
    '/parts-diagrams', '/parts-finder'
  ];

  if (blacklistDirectories.some(dir => lowerUrl.includes(dir))) return false; 

  const whitelistDirectories = [
    '/brands', '/manufacturer-models', '/model-list', 
    '/inventory', '/search', 'searchinventory', '-vehicles',
    '/promotions', '/oem-promotions', '/promotion', '/promo',
    '/parts', '/accessories', '/parts-department',
    '/finance', '/credit', '/service', '/about', '/contact', '/faq'
  ];

  try {
    const url = new URL(urlStr);
    const pathname = url.pathname.toLowerCase();
    
    if (pathname === '/' || pathname === '') return true;
    return whitelistDirectories.some(dir => pathname.includes(dir));
  } catch (e) {
    return false;
  }
}

export function groupDiscoveredLinks(links) {
  const grouped = {
    collections: { brandDirectories: [], brandModelLists: [], modelCatalogFilters: [] },
    inventory: {
      newInventory: { mainLinks: [], vehicles: [] },
      usedInventory: { mainLinks: [], vehicles: [] },
      generalInventory: { mainLinks: [], vehicles: [] }
    },
    promotions: [],      
    parts: [],           
    staticPages: [],
    blogs: [],           // <-- ADDED: Dedicated array for blog & news links
    other: []
  };

  for (const link of links) {
    if (link.category === 'collection') {
      if (link.subCategory === 'brand-directory') grouped.collections.brandDirectories.push(link);
      else if (link.subCategory === 'brand-model-list') grouped.collections.brandModelLists.push(link);
      else grouped.collections.modelCatalogFilters.push(link);
    } 
    else if (link.category === 'inventory') {
      if (link.subCategory === 'new-inventory') grouped.inventory.newInventory.mainLinks.push(link);
      else if (link.subCategory === 'used-inventory') grouped.inventory.usedInventory.mainLinks.push(link);
      else grouped.inventory.generalInventory.mainLinks.push(link);
    } 
    else if (link.category === 'product') {
      if (link.subCategory === 'new-product') grouped.inventory.newInventory.vehicles.push(link);
      else if (link.subCategory === 'used-product') grouped.inventory.usedInventory.vehicles.push(link);
      else grouped.inventory.generalInventory.vehicles.push(link);
    } 
    else if (link.category === 'blog') {
      grouped.blogs.push(link); // <-- ADDED: Routes blog category links here
    }
    else if (link.category === 'page') {
      if (link.subCategory === 'promotion-page') grouped.promotions.push(link);
      else if (link.subCategory === 'parts-page' || link.subCategory === 'service-page') grouped.parts.push(link);
      else grouped.staticPages.push(link);
    } 
    else {
      grouped.other.push(link);
    }
  }

  return grouped;
}
export function extractPageMetadata(html) {
  const $ = cheerio.load(html);
  let extractedPrice = '';

  $('script[type="application/ld+json"]').each((_, el) => {
    if (extractedPrice) return;
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'Vehicle') {
          if (item.offers?.price) extractedPrice = `$${item.offers.price}`;
        }
      }
    } catch (e) {}
  });

  if (!extractedPrice) {
    const priceSelectors = ['.price', '[class*="price"]', '.sale-price', '.msrp', '.regular-price'];
    for (const selector of priceSelectors) {
      const text = $(selector).first().text().trim();
      if (text && /\d/.test(text)) {
        extractedPrice = text;
        break;
      }
    }
  }

  if (!extractedPrice) {
    const bodyText = $('body').text();
    const match = bodyText.match(/(?:price|msrp)\s*:?\s*\$?([0-9,]{3,8})/i);
    if (match) extractedPrice = `$${match[1]}`;
  }

  let year = '', brandName = '', modelName = '', vehicleType = 'Vehicle';
  const vdpHeader = $('h1, .vdp-title, [class*="vehicle-title"]').first().text().trim();
  
  if (vdpHeader) {
    const tokens = vdpHeader.toLowerCase().split(/[\s\-_%+]+/).filter(Boolean);
    const yearMatch = vdpHeader.match(/\b(19[8-9]\d|20[0-2]\d)\b/);
    if (yearMatch) year = yearMatch[1];

    const knownBrands = ['yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'atlas', 'seadoo', 'sea-doo'];
    const foundBrand = tokens.find(t => knownBrands.includes(t));
    if (foundBrand) brandName = foundBrand.charAt(0).toUpperCase() + foundBrand.slice(1);
  }

  return { 
    price: extractedPrice,
    year,
    brandName,
    modelName,
    vehicleType
  };
}

export function extractDealershipProfile(html, currentUrl) {
  const $ = cheerio.load(html);
  const profile = {
    dealershipName: '', legalCorporateName: '', dbaAlternateName: '', streetAddress: '',
    city: '', state: '', zipCode: '', telephoneMainLine: '', telephoneFax: '', 
    latitude: '', longitude: '', googleBusinessUrl: '', logoUrl: '', platform: '',
    socialLinks: { facebook: '', instagram: '', youtube: '', twitter: '' },
    requiredUrls: { parts: '', service: '', finance: '' },
    actionUrls: { serviceScheduler: '', partsRequest: '', tradeIn: '', testRide: '', staff: '', blog: '', events: '', testimonials: '' },
    departmentPhones: { sales: '', service: '', parts: '' },
    storeHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' }
  };

  const htmlLower = html.toLowerCase();
  if (htmlLower.includes('powered by dx1') || htmlLower.includes('dx1app.com')) profile.platform = 'DX1';
  else if (htmlLower.includes('dealer spike')) profile.platform = 'Dealer Spike';
  else if (htmlLower.includes('ari network') || htmlLower.includes('arinet')) profile.platform = 'ARI';
  else if (htmlLower.includes('wp-content')) profile.platform = 'WordPress';

  // Logo Harvesting
  $('header img, img.logo, img[id*="logo"], a.navbar-brand img').each((_, el) => {
    if (!profile.logoUrl) {
      const src = $(el).attr('src');
      if (src && !src.includes('data:image')) {
        profile.logoUrl = new URL(src, currentUrl).toString();
      }
    }
  });

  // UNTOUCHED ORIGINAL DEALERSHIP NAME & IDENTITY BLOCK (Works 100%)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'AutoDealer' || item['@type'] === 'LocalBusiness' || item['@type'] === 'AutomotiveBusiness' || item['@type'] === 'MotorcycleDealer') {
          if (item.name) profile.dealershipName = item.name;
          if (item.legalName) profile.legalCorporateName = item.legalName;
          if (item.telephone) profile.telephoneMainLine = item.telephone;
          if (item.address) {
            profile.streetAddress = item.address.streetAddress || '';
            profile.city = item.address.addressLocality || '';
            profile.state = item.address.addressRegion || '';
            profile.zipCode = item.address.postalCode || '';
          }
        }
      }
    } catch (e) {}
  });

  // 4. AUTONOMOUS SCOPED FOOTER HOURS SCANNER
  const dayMap = {
    monday: ['monday', 'mon.', 'mon'],
    tuesday: ['tuesday', 'tue.', 'tue'],
    wednesday: ['wednesday', 'wed.', 'wed'],
    thursday: ['thursday', 'thu.', 'thr.', 'thu', 'thr'],
    friday: ['friday', 'fri.', 'fri'],
    saturday: ['saturday', 'sat.', 'sat'],
    sunday: ['sunday', 'sun.', 'sun']
  };

  $('footer, .footer, #footer, [class*="footer"], .hours-operation, .hours-block').find('tr, li, p, span, td, div').each((_, el) => {
    const rawText = $(el).text().replace(/\s+/g, ' ').trim();
    const lowerText = rawText.toLowerCase();
    
    if (lowerText.length < 80) {
      Object.keys(dayMap).forEach(day => {
        if (!profile.storeHours[day]) {
          const matched = dayMap[day].some(variant => lowerText.startsWith(variant) || lowerText.includes(variant));
          
          if (matched) {
            if (lowerText.includes('closed') || lowerText.includes('close')) {
              profile.storeHours[day] = 'Closed';
            } 
            else if (/(\d)/.test(lowerText)) {
              profile.storeHours[day] = rawText;
            }
          }
        }
      });
    }
  });

  // 5. FIXED DEPARTMENT PHONE SCRAPER: Enforces strict word keywords matching to prevent random numbers
  $('a[href^="tel:"], p, div, span, tr, td').each((_, el) => {
    const text = $(el).text().trim();
    const phoneMatches = [...text.matchAll(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g)].map(m => m[0]);
    if (!phoneMatches.length) return;

    const directText = text.toLowerCase();
    const parentText = $(el).parent().text().toLowerCase();
    const combinedContext = `${directText} ${parentText}`;
    const isFaxContext = /\bfax\b/i.test(directText) || /\bfax\b/i.test(parentText);

    let cleanPhone = phoneMatches[0];
    const faxLabelMatch = /(?:fax|facsimile)[:\s]*((?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i.exec(text);

    if (faxLabelMatch) {
      cleanPhone = faxLabelMatch[1];
    } else if (isFaxContext && phoneMatches.length > 1) {
      cleanPhone = phoneMatches[phoneMatches.length - 1];
    }

    if (isFaxContext) {
      if (!profile.telephoneFax) {
        profile.telephoneFax = cleanPhone;
      }
      return; 
    }

    // Set main line if clicking a direct tel anchor link
    if (!profile.telephoneMainLine && $(el).is('a[href^="tel:"]')) {
      profile.telephoneMainLine = cleanPhone;
    }
    
    // Strict Proximity Guard: Only assign if keyword matches the specific row string text
    if (/\bsales\b/i.test(combinedContext) && !profile.departmentPhones.sales) {
      profile.departmentPhones.sales = cleanPhone;
    }
    if (/\bservice\b/i.test(combinedContext) && !profile.departmentPhones.service) {
      profile.departmentPhones.service = cleanPhone;
    }
    if (/\bparts\b/i.test(combinedContext) && !profile.departmentPhones.parts) {
      profile.departmentPhones.parts = cleanPhone;
    }
  });

  // Google Business Maps iFrames Tracker
  $('iframe[src*="maps.google"], iframe[src*="google.com/maps"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !profile.googleBusinessUrl) {
      profile.googleBusinessUrl = src;
      const geoMatch = src.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
      if (geoMatch) {
        profile.longitude = geoMatch[1];
        profile.latitude = geoMatch[2];
      }
    }
  });

  // Action Conversion Anchor Links Sniffer
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const className = $(el).attr('class') || '';
    if (!href) return;
    const lowerHref = href.toLowerCase();
    const lowerClass = className.toLowerCase();

    if ((lowerHref.includes('facebook.com/') || lowerClass.includes('facebook')) && !profile.socialLinks.facebook) profile.socialLinks.facebook = href;
    if ((lowerHref.includes('instagram.com/') || lowerClass.includes('instagram')) && !profile.socialLinks.instagram) profile.socialLinks.instagram = href;
    if ((lowerHref.includes('youtube.com/') || lowerClass.includes('youtube')) && !profile.socialLinks.youtube) profile.socialLinks.youtube = href;
    if ((lowerHref.includes('twitter.com/') || lowerHref.includes('x.com/') || lowerClass.includes('twitter')) && !profile.socialLinks.twitter) profile.socialLinks.twitter = href;

    if ((lowerHref.includes('/parts') || lowerHref.includes('parts-department')) && !profile.requiredUrls.parts && !lowerHref.startsWith('http')) profile.requiredUrls.parts = new URL(href, currentUrl).toString();
    if ((lowerHref.includes('/service') || lowerHref.includes('service-department')) && !profile.requiredUrls.service && !lowerHref.startsWith('http')) profile.requiredUrls.service = new URL(href, currentUrl).toString();
    if ((lowerHref.includes('/finance') || lowerHref.includes('/credit')) && !profile.requiredUrls.finance && !lowerHref.startsWith('http')) profile.requiredUrls.finance = new URL(href, currentUrl).toString();

    if ((lowerHref.includes('schedule') || lowerHref.includes('appointment')) && !profile.actionUrls.serviceScheduler && !lowerHref.startsWith('http')) profile.actionUrls.serviceScheduler = new URL(href, currentUrl).toString();
    if (lowerHref.includes('parts-request') && !profile.actionUrls.partsRequest && !lowerHref.startsWith('http')) profile.actionUrls.partsRequest = new URL(href, currentUrl).toString();
    if ((lowerHref.includes('value-your-trade') || lowerHref.includes('trade-in')) && !profile.actionUrls.tradeIn && !lowerHref.startsWith('http')) profile.actionUrls.tradeIn = new URL(href, currentUrl).toString();
    if ((lowerHref.includes('test-ride') || lowerHref.includes('schedule-ride')) && !profile.actionUrls.testRide && !lowerHref.startsWith('http')) profile.actionUrls.testRide = new URL(href, currentUrl).toString();

    if ((lowerHref.includes('/staff') || lowerHref.includes('/our-team')) && !profile.actionUrls.staff && !lowerHref.startsWith('http')) profile.actionUrls.staff = new URL(href, currentUrl).toString();
    if ((lowerHref.includes('/blog') || lowerHref.includes('/news')) && !profile.actionUrls.blog && !lowerHref.startsWith('http')) profile.actionUrls.blog = new URL(href, currentUrl).toString();
    if ((lowerHref.includes('/events') || lowerHref.includes('/calendar')) && !profile.actionUrls.events && !lowerHref.startsWith('http')) profile.actionUrls.events = new URL(href, currentUrl).toString();
    if ((lowerHref.includes('testimonial') || lowerHref.includes('review')) && !profile.actionUrls.testimonials && !lowerHref.startsWith('http')) profile.actionUrls.testimonials = new URL(href, currentUrl).toString();
  });

  return profile;
}

export function parseAndExtractLinks(html, currentUrl, targetUrl, targetDomain, session, currentDepth) {
  const $ = cheerio.load(html);
  const elements = $('a').toArray();

  for (const element of elements) {
    if (session.isTerminated) break;

    if (session.discoveredLinks.length >= 10000) {
      session.queue = []; 
      break;
    }

    const href = $(element).attr('href');
    if (!href) continue;

    try {
      const absoluteUrl = new URL(href, currentUrl);
      const cleanUrl = canonicalizeUrl(absoluteUrl.toString());

      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) continue;
      if (isAssetUrl(cleanUrl)) continue;

      const isInternal = getCleanDomain(cleanUrl) === targetDomain;
      if (!isInternal) continue;

      let anchorText = $(element).text().trim();
      if (!anchorText) {
        const innerImg = $(element).find('img');
        anchorText = innerImg.length ? $(innerImg).attr('alt')?.trim() || '[Image Link]' : '[No Text]';
      }

      if (!session.seenUniqueLinks.has(cleanUrl)) {
        session.seenUniqueLinks.add(cleanUrl);
        const { category, subCategory } = getUrlCategoryAndSub(cleanUrl);
        const autoDetails = extractAutoDetailsFromUrl(cleanUrl);

        session.discoveredLinks.push({
          url: cleanUrl,
          text: anchorText || '[No Text]',
          type: 'internal',
          category,
          subCategory,
          statusCode: 200,
          price: '',
          year: autoDetails.year || '',
          brandName: autoDetails.brandName || '',
          modelName: autoDetails.modelName || '',
          vehicleType: autoDetails.vehicleType || 'Vehicle',
          verificationStatus: category === 'product' ? 'missing' : 'not_applicable'
        });

        if (category !== 'product' && isCrawlablePath(cleanUrl, currentDepth)) {
          if (!session.visitedUrls.has(cleanUrl) && !session.queue.some(q => q.url === cleanUrl)) {
            session.queue.push({ url: cleanUrl, depth: currentDepth + 1 });
          }
        }
      }
    } catch (e) {}
  }
}