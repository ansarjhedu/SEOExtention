// services/crawler/platforms/ariEngine.js

import * as cheerio from 'cheerio';
import { getCleanDomain, isAssetUrl, canonicalizeUrl } from '../utils.js';

// ============================================================================
// PERFORMANCE: Globally pre-compiled Regex definitions & Configs
// ============================================================================
const YEAR_HEADER_REGEX = /\b(19[8-9]\d|20[0-2]\d)\b/;
const PRICE_TEXT_REGEX = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/;
const PHONE_EXTRACT_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const GOOGLE_MAPS_GEO_REGEX = /!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/;

const KNOWN_BRANDS = [
  'yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'seadoo', 
  'sea-doo', 'skidoo', 'ski-doo', 'harley-davidson', 'indian', 'triumph', 'ducati', 'bmw', 'vespa', 
  'husqvarna', 'tracker', 'tracker-off-road', 'hisun', 'kymco', 'textron', 'arctic-cat'
];

const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// ============================================================================
// 1. ARI LINK FILTERING (STRICT PARTSTREAM & FICHE BLACKSHIELD)
// ============================================================================
export function shouldIgnoreLink(urlStr) {
  const urlLower = urlStr.toLowerCase();
  
  // 1. Explicit Directories to completely kill
  const ignorePatterns = [
    '/event', '/calendar', '/gallery', '/review', '/testimonial', 
    '/social', '/widget', '/forum', '/job', '/career', '/employment', 
    '/oemparts', '/fiche', '/microfiche', '/partsfinder', '/parts-finder', 
    '/arinet', '/cart', '/checkout', '/account', '/shop/category', 
    '/privacy', '/terms', '/print', 'print=true', '/send-to-friend'
  ];

  if (ignorePatterns.some(pattern => urlLower.includes(pattern))) return true;

  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    
    // 2. The Deep-Parts Shield: ARI sites use heavy PartStream integrations.
    // We block anything deeper than the top-level parts landing pages.
    if (pathname.match(/^\/oemparts\/.+/)) return true;
    if (pathname.match(/^\/parts\/.+/)) return true;
    if (pathname.match(/^\/arinet\/.+/)) return true;
    
    // 3. ARI Matrix Shield: Prevent crawling infinite pagination permutations of catalogs
    if (pathname.includes('/catalog/') || pathname.includes('/showrooms/')) {
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length > 3) return true; // Kills deep routing like /Showrooms/Yamaha/Motorcycles/2026
    }
  } catch (e) {}

  return false;
}

// ============================================================================
// 2. STRICT, MUTUALLY EXCLUSIVE URL CATEGORIZATION ROUTER
// ============================================================================
export function categorizeLink(urlStr, statusCode = 200) {
  let url;
  try { url = new URL(urlStr); } catch (e) { return { category: 'page', subCategory: 'static' }; }

  const urlLower = urlStr.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  const pathSegments = pathname.split('/').filter(Boolean);
  const hasBrandSegment = pathSegments.some(seg => KNOWN_BRANDS.includes(seg) || KNOWN_BRANDS.includes(seg.replace(/-/g, ' ')));

  // TIER 1: Errors / 404 Dead Links (Highest Priority)
  if (statusCode === 404 || pathname.includes('/404') || pathname.includes('page-not-found')) {
    return { category: 'dead_link', subCategory: '404-error' };
  }

  // TIER 2: Explicit Functional Content (Catch before Brands/Products)
  if (pathname.match(/\/(blog|news|article|articles)/)) return { category: 'blog', subCategory: 'article' };
  if (pathname.match(/\/(parts|accessories|parts-department|order-parts)/)) return { category: 'page', subCategory: 'parts-page' };
  if (pathname.match(/\/(service|service-department|schedule-service)/)) return { category: 'page', subCategory: 'service-page' };
  if (pathname.match(/\/(promotions?|promo|special-offers|specials|current-offers|factory-promotions|sales-events|offers)/)) return { category: 'page', subCategory: 'promotion-page' };
  if (pathname.match(/\/(testimonial|reviews|customer-feedback)/)) return { category: 'page', subCategory: 'testimonials' };
  if (pathname.match(/\/(events|calendar|shows)/)) return { category: 'page', subCategory: 'events' };

  // TIER 2.5: The Disguised Category Shield
  // ARI VDPs always contain a distinct numeric ID at the end of the slug (e.g. /inventory/v1/Current/Yamaha/Motorcycle/YZF-R1-12345678)
  const hasInventoryID = /-\d{5,}\/?$/.test(pathname);
  
  if ((pathname.includes('/inventory/v1/') || pathname.includes('/inventory/')) && !hasInventoryID) {
    return { category: 'inventory', subCategory: 'category-inventory' }; // It's a grid, not a vehicle
  }

  // TIER 3: Strict Product Detail Pages (VDPs)
  const isProduct = (pathname.includes('/inventory/') || pathname.includes('/product/')) && hasInventoryID;
  if (isProduct) {
    const isUsed = pathname.includes('pre-owned') || pathname.includes('used');
    return { category: 'product', subCategory: isUsed ? 'used-product' : 'new-product' };
  }

  // TIER 4: Inventory Index Scanners
  if (pathname.match(/\/(inventory|search|all-inventory|vehicles|rv-search)/)) {
    let subCategory = 'general-inventory';
    if (pathname.includes('/new')) subCategory = 'new-inventory';
    else if (pathname.includes('pre-owned') || pathname.includes('used')) subCategory = 'used-inventory';
    return { category: 'inventory', subCategory };
  }

  // TIER 5: Brand Showrooms & Model Hubs
  if (pathname.match(/\/(brands?|showrooms?|manufacturer-models|oem-models|catalogs?|manufacturers?|model-list)/) || hasBrandSegment) {
    return { category: 'collection', subCategory: 'brand-directory' };
  }

  // TIER 6: Safe Fallback
  return { category: 'page', subCategory: 'static' };
}

// ============================================================================
// 3. URL DETAIL EXTRACTION LOGIC
// ============================================================================
export function extractAutoDetails(urlStr) {
  const details = { year: '', brandName: '', modelName: '', vehicleType: 'Vehicle' };
  try {
    const pathname = new URL(urlStr).pathname;
    const slug = pathname.split('/').filter(Boolean).pop() || ''; 
    const lowerSlug = slug.toLowerCase();

    if (lowerSlug.includes('motorcycle')) details.vehicleType = 'Motorcycle';
    else if (lowerSlug.includes('atv') || lowerSlug.includes('quad')) details.vehicleType = 'ATV';
    else if (lowerSlug.includes('utility-vehicle') || lowerSlug.includes('utv') || lowerSlug.includes('side-by-side')) details.vehicleType = 'UTV';
    else if (lowerSlug.includes('personal-watercraft') || lowerSlug.includes('pwc') || lowerSlug.includes('waverunner')) details.vehicleType = 'PWC';
    else if (lowerSlug.includes('scooter')) details.vehicleType = 'Scooter';
    else if (lowerSlug.includes('snowmobile')) details.vehicleType = 'Snowmobile';
    else if (lowerSlug.includes('boat') || lowerSlug.includes('pontoon')) details.vehicleType = 'Boat';

    const yearMatch = slug.match(/-((?:19|20)\d{2})-/);
    if (yearMatch) details.year = yearMatch[1];

    for (const b of KNOWN_BRANDS) {
      const normalizedBrand = b.replace(/-/g, ' ');
      if (lowerSlug.includes(`-${b}-`) || lowerSlug.startsWith(`${b}-`) || lowerSlug.includes(normalizedBrand.replace(/ /g, '-'))) {
        details.brandName = normalizedBrand.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        break;
      }
    }
  } catch (e) {}
  return details;
}

// ============================================================================
// 4. CRAWLABLE PATH VALIDATION
// ============================================================================
export function isCrawlablePath(urlStr, currentDepth = 0) {
  if (currentDepth >= 5) return false; // Allowed deep for grids/pagination
  if (shouldIgnoreLink(urlStr)) return false;
  return true;
}

// ============================================================================
// 5. ARI METADATA & PRICE EXTRACTION
// ============================================================================
export function extractPageMetadata(htmlOrSelector) {
  const $ = typeof htmlOrSelector === 'function' ? htmlOrSelector : cheerio.load(htmlOrSelector);
  let extractedPrice = '';
  let potentialPrices = [];

  // 1. JSON-LD Extraction
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if ((item['@type'] === 'Product' || item['@type'] === 'Vehicle') && item.offers && item.offers.price) {
            if (parseFloat(item.offers.price) > 0) {
              potentialPrices.push(parseFloat(item.offers.price));
            }
        }
      }
    } catch (e) {}
  });

  // 2. Strict DOM Hierarchy Price Scanner (Prioritizing Sale Prices)
  const discountSelectors = ['.our-price', '.sale-price', '.internet-price', '.final-price', '[data-price]'];
  for (const selector of discountSelectors) {
    const rawText = $(selector).text().replace(/\s+/g, ' ').trim();
    const priceMatch = rawText.match(PRICE_TEXT_REGEX);
    if (priceMatch) {
      const parsedVal = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (parsedVal > 1000) potentialPrices.push(parsedVal);
    }
  }

  // 3. Fallback to MSRP and base class selectors
  if (potentialPrices.length === 0) {
    const generalSelectors = ['.price', '.msrp', '.veh-price', '.unit-price'];
    for (const selector of generalSelectors) {
      const rawText = $(selector).first().text().replace(/\s+/g, ' ').trim();
      const priceMatch = rawText.match(PRICE_TEXT_REGEX);
      if (priceMatch) {
        const parsedVal = parseFloat(priceMatch[1].replace(/,/g, ''));
        if (parsedVal > 1000) potentialPrices.push(parsedVal);
      }
    }
  }

  if (potentialPrices.length > 0) {
    const minPrice = Math.min(...potentialPrices);
    extractedPrice = `$${minPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
  }

  let year = '', brandName = '', modelName = '', vehicleType = 'Vehicle';
  const vdpHeader = $('h1, .vdp-title, .product-title, [class*="vehicle-title"]').first().text().replace(/\s+/g, ' ').trim();
  
  if (vdpHeader) {
    const yearMatch = vdpHeader.match(YEAR_HEADER_REGEX);
    if (yearMatch) year = yearMatch[1];

    const lowerHeader = vdpHeader.toLowerCase();

    if (lowerHeader.includes('motorcycle')) vehicleType = 'Motorcycle';
    else if (lowerHeader.includes('atv') || lowerHeader.includes('quad')) vehicleType = 'ATV';
    else if (lowerHeader.includes('utility vehicle') || lowerHeader.includes('utv') || lowerHeader.includes('side by side')) vehicleType = 'UTV';
    else if (lowerHeader.includes('personal watercraft') || lowerHeader.includes('pwc') || lowerHeader.includes('waverunner')) vehicleType = 'PWC';
    
    for (const b of KNOWN_BRANDS) {
      const cleanB = b.replace(/-/g, ' ');
      if (lowerHeader.includes(` ${cleanB} `) || lowerHeader.startsWith(`${cleanB} `)) {
        brandName = cleanB.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        
        const brandIndex = lowerHeader.indexOf(cleanB);
        let rawModel = vdpHeader.substring(brandIndex + cleanB.length).trim();
        
        if (year) rawModel = rawModel.replace(new RegExp(`\\b${year}\\b`, 'i'), '').trim();
        rawModel = rawModel.replace(/new|used|for sale|pre-owned/ig, '').trim();
        rawModel = rawModel.replace(/^[-:/,\s]+|[-:/,\s]+$/g, '');

        if (rawModel) modelName = rawModel;
        break;
      }
    }
  }

  return { price: extractedPrice, year, brandName, modelName, vehicleType };
}

// ============================================================================
// 6. STRICT ENTITY & NAP DATA EXTRACTION
// ============================================================================
export function extractDealershipProfile(htmlOrSelector, currentUrl) {
  const $ = typeof htmlOrSelector === 'function' ? htmlOrSelector : cheerio.load(htmlOrSelector);
  const rawHtmlString = typeof htmlOrSelector === 'string' ? htmlOrSelector : $.html();

  const profile = {
    dealershipName: '', legalCorporateName: '', dbaAlternateName: '', streetAddress: '',
    city: '', state: '', zipCode: '', telephoneMainLine: '', telephoneFax: '', 
    latitude: '', longitude: '', googleBusinessUrl: '', logoUrl: '', platform: 'ARI',
    socialLinks: { facebook: '', instagram: '', youtube: '', twitter: '' },
    requiredUrls: { parts: '', service: '', finance: '' },
    actionUrls: { serviceScheduler: '', partsRequest: '', tradeIn: '', testRide: '', staff: '', blog: '', events: '', testimonials: '', googleReviews: '' },
    departmentPhones: { sales: '', service: '', parts: '' },
    storeHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' },
    serviceHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' }
  };

  // --- 1. LOGO EXTRACTION ---
  $('header img, img.logo, img[id*="logo"], .site-logo img, .navbar-brand img').each((_, el) => {
    if (!profile.logoUrl) {
      const src = $(el).attr('src');
      if (src && !src.includes('data:image')) profile.logoUrl = new URL(src, currentUrl).toString();
    }
  });

  // --- 2. STRICT SCHEMA EXTRACT ---
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      let items = data['@graph'] ? data['@graph'] : (Array.isArray(data) ? data : [data]);
      for (const item of items) {
        if (item['@type'] === 'AutoDealer' || item['@type'] === 'LocalBusiness' || item['@type'] === 'AutomotiveBusiness' || item['@type'] === 'Organization') {
          if (item.name) {
            const candidate = item.name.replace(/\s+/g, ' ').trim();
            if (candidate.length > 2 && candidate.length < 60) profile.dealershipName = candidate;
          }
          if (item.legalName) {
            const candidate = item.legalName.replace(/\s+/g, ' ').trim();
            if (candidate.length > 3 && candidate.length < 60 && !candidate.includes('http')) profile.legalCorporateName = candidate;
          }
          if (item.telephone && !profile.telephoneMainLine) profile.telephoneMainLine = item.telephone;
          if (item.address) {
            profile.streetAddress = item.address.streetAddress || profile.streetAddress;
            profile.city = item.address.addressLocality || profile.city;
            profile.state = item.address.addressRegion || profile.state;
            profile.zipCode = item.address.postalCode || profile.zipCode;
          }
          if (item.geo) {
            if (item.geo.latitude) profile.latitude = String(item.geo.latitude);
            if (item.geo.longitude) profile.longitude = String(item.geo.longitude);
          }
          if (item.sameAs && Array.isArray(item.sameAs)) {
             item.sameAs.forEach(link => {
                const sl = link.toLowerCase();
                if (sl.includes('facebook.com') && !profile.socialLinks.facebook) profile.socialLinks.facebook = link;
                if (sl.includes('instagram.com') && !profile.socialLinks.instagram) profile.socialLinks.instagram = link;
                if (sl.includes('youtube.com') && !profile.socialLinks.youtube) profile.socialLinks.youtube = link;
                if ((sl.includes('twitter.com') || sl.includes('x.com')) && !profile.socialLinks.twitter) profile.socialLinks.twitter = link;
             });
          }
        }
      }
    } catch (e) {}
  });

  // --- 3. HARDENED DEALERSHIP NAME FALLBACK ---
  if (!profile.dealershipName) {
    profile.dealershipName = $('meta[property="og:site_name"]').attr('content') || $('meta[name="author"]').attr('content') || '';
    if (!profile.dealershipName || profile.dealershipName.length > 60) {
      const rawTitle = $('title').first().text();
      let cleanTitle = rawTitle.split(/\||-/)[0].trim();
      if (cleanTitle.toLowerCase() === 'home' && rawTitle.split(/\||-/).length > 1) {
          cleanTitle = rawTitle.split(/\||-/)[1].trim();
      }
      if (cleanTitle && cleanTitle.length < 60) profile.dealershipName = cleanTitle;
    }
  }

  // --- 4. STRICT FOOTER CORPORATE NAME EXTRACTOR ---
  if (!profile.legalCorporateName || profile.legalCorporateName.length > 60) {
    const footerText = $('footer, .footer, #footer, .site-footer, .copyright').text().replace(/\s+/g, ' ');
    const cpMatch = footerText.match(/(?:©|Copyright)\s*(?:20\d{2}(?:\s*-\s*20\d{2})?)?\s*([^|•\-.,]+?(?:LLC|Inc\.?|Corp\.?|Ltd\.?)?)(?=\s+\||All Rights|Privacy|Terms|Website|Powered|$)/i);
    
    if (cpMatch && cpMatch[1]) {
      let name = cpMatch[1].replace(/all rights reserved/ig, '').replace(/powered by ari/ig, '').replace(/website by.*/ig, '').trim();
      if (name.length > 2 && name.length < 60) profile.legalCorporateName = name;
    }
  }

  if (!profile.legalCorporateName && profile.dealershipName) {
    profile.legalCorporateName = `${profile.dealershipName} LLC (Assumed)`;
  }

  // --- 5. VISUAL LINE-READER HOURS PARSING (Protects Context) ---
  let currentContext = 'storeHours'; 

  $('.hours, .store-hours, .hours-operation, .contact-info, .department-hours, footer, .footer').each((_, container) => {
    const $clone = $(container).clone();
    $clone.find('a').remove(); // Prevent link leakage
    $clone.find('br').replaceWith('\n');
    $clone.find('p, div, li, tr, h1, h2, h3, h4, h5, h6').append('\n');

    const visualLines = $clone.text().split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.length >= 3 && line.length < 80);

    visualLines.forEach(line => {
      const lowerLine = line.toLowerCase();

      if (lowerLine.includes('service') || lowerLine.includes('parts')) {
        currentContext = 'serviceHours';
        return; 
      } else if (lowerLine.includes('sales') || lowerLine.includes('store') || lowerLine.includes('showroom')) {
        currentContext = 'storeHours';
        return;
      }

      const activeHoursProfile = profile[currentContext];
      const timeMatch = lowerLine.match(/(closed|24 hours|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\s*(?:-|to|thru|until|:)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i);
      const extractedTime = timeMatch ? timeMatch[1].toUpperCase() : line;
      const hasTime = /\d{1,2}(?::\d{2})?/i.test(lowerLine);
      const isClosed = lowerLine.includes('closed');

      if (hasTime || isClosed) {
        const rangeMatch = lowerLine.match(/(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:-|to|thru)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/i);
        if (rangeMatch) {
          const startDayPrefix = rangeMatch[1].toLowerCase();
          const endDayPrefix = rangeMatch[2].toLowerCase();
          const startIdx = DAYS_OF_WEEK.findIndex(d => d.startsWith(startDayPrefix));
          const endIdx = DAYS_OF_WEEK.findIndex(d => d.startsWith(endDayPrefix));

          if (startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx) {
            for (let i = startIdx; i <= endIdx; i++) {
              if (!activeHoursProfile[DAYS_OF_WEEK[i]]) activeHoursProfile[DAYS_OF_WEEK[i]] = extractedTime; 
            }
          }
        } else {
          DAYS_OF_WEEK.forEach(day => {
            if (lowerLine.includes(day) || lowerLine.includes(day.substring(0, 3))) {
              if (!activeHoursProfile[day]) activeHoursProfile[day] = extractedTime;
            }
          });
        }
      }
    });
  });

  // --- 6. CONTEXTUAL PHONE DEPARTMENT ROUTING ---
  const allPhones = [...new Set(rawHtmlString.match(PHONE_EXTRACT_REGEX) || [])];
  if (allPhones.length > 0 && !profile.telephoneMainLine) profile.telephoneMainLine = allPhones[0];

  $('a[href^="tel:"], p, div, span, tr, td').each((_, el) => {
    const text = $(el).text().trim();
    const phoneMatches = [...text.matchAll(PHONE_EXTRACT_REGEX)].map(m => m[0]);
    if (!phoneMatches.length) return;
    
    const combinedContext = `${text} ${$(el).parent().text()}`.toLowerCase();
    const isFaxContext = /\bfax\b/i.test(combinedContext);
    let cleanPhone = phoneMatches[0];
    
    const faxLabelMatch = /(?:fax|facsimile)[:\s]*((?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i.exec(text);
    if (faxLabelMatch) cleanPhone = faxLabelMatch[1];
    else if (isFaxContext && phoneMatches.length > 1) cleanPhone = phoneMatches[phoneMatches.length - 1];

    if (isFaxContext) { if (!profile.telephoneFax) profile.telephoneFax = cleanPhone; return; }
    if (/\bsales\b/i.test(combinedContext) && !profile.departmentPhones.sales) profile.departmentPhones.sales = cleanPhone;
    if (/\bservice\b/i.test(combinedContext) && !profile.departmentPhones.service) profile.departmentPhones.service = cleanPhone;
    if (/\bparts\b/i.test(combinedContext) && !profile.departmentPhones.parts) profile.departmentPhones.parts = cleanPhone;
  });

  // --- 7. DEEP ACTION LINK & INTERNAL MAP SCANNING ---
  $('a, button, div.review-btn').each((_, el) => {
    const href = $(el).attr('href') || '';
    const onclick = $(el).attr('onclick') || ''; 
    const anchorText = $(el).text().toLowerCase().trim();
    
    const safeHref = href.toLowerCase();
    const safeOnclick = onclick.toLowerCase();
    const targetLink = (safeHref + ' ' + safeOnclick);

    if (!targetLink || targetLink.trim() === '' || targetLink.includes('javascript:void(0)')) return;
    if (safeHref === '#' || safeHref === '/' || safeHref.startsWith('javascript:')) return;

    const buildUrl = (path) => { try { return new URL(path, currentUrl).toString(); } catch { return path; } };

    if (anchorText.includes('directions') || anchorText.includes('map') || safeHref.includes('directions') || safeHref.includes('location')) {
      if (safeHref.includes('google.com/maps') || safeHref.includes('g.page')) {
        profile.googleBusinessUrl = href; 
      } else if (!profile.googleBusinessUrl && !safeHref.includes('javascript')) {
        profile.googleBusinessUrl = buildUrl(href); 
      }
    }

    if (targetLink.includes('facebook.com/') && !profile.socialLinks.facebook) profile.socialLinks.facebook = href;
    if (targetLink.includes('instagram.com/') && !profile.socialLinks.instagram) profile.socialLinks.instagram = href;
    if (targetLink.includes('youtube.com/') && !profile.socialLinks.youtube) profile.socialLinks.youtube = href;
    if ((targetLink.includes('twitter.com/') || targetLink.includes('x.com/')) && !profile.socialLinks.twitter) profile.socialLinks.twitter = href;

    if (!profile.requiredUrls.parts && (safeHref.match(/\/(parts-department|parts|accessories)\b/) || anchorText.includes('parts department') || anchorText === 'parts')) profile.requiredUrls.parts = buildUrl(href);
    if (!profile.requiredUrls.service && (safeHref.match(/\/(service-department|service|repair)\b/) || anchorText.includes('service department') || anchorText === 'service')) profile.requiredUrls.service = buildUrl(href);
    if (!profile.requiredUrls.finance && (safeHref.match(/\/(finance-application|finance|financing|credit)\b/) || anchorText.includes('finance') || anchorText.includes('financing'))) profile.requiredUrls.finance = buildUrl(href);

    if (!profile.actionUrls.serviceScheduler && (safeHref.match(/\/(schedule-service|service-appointment|appointment)\b/) || anchorText.includes('schedule service'))) profile.actionUrls.serviceScheduler = buildUrl(href);
    if (!profile.actionUrls.partsRequest && (safeHref.match(/\/(request-parts|parts-request|order-parts)\b/) || anchorText.includes('order parts') || anchorText.includes('request parts'))) profile.actionUrls.partsRequest = buildUrl(href);
    if (!profile.actionUrls.tradeIn && (safeHref.match(/\/(value-your-trade|trade-in|trade)\b/) || anchorText.includes('value your trade') || anchorText.includes('trade in'))) profile.actionUrls.tradeIn = buildUrl(href);
    
    if (!profile.actionUrls.testimonials && (safeHref.match(/\/(testimonial|reviews|customer-feedback)\b/) || anchorText.includes('testimonials') || anchorText.includes('read reviews')) && !safeHref.includes('google')) {
      profile.actionUrls.testimonials = buildUrl(href);
    }
    
    if (!profile.actionUrls.testRide && (safeHref.match(/\/(schedule-a-test-ride|test-ride|request-info|contact-sales)\b/) || anchorText.includes('test ride') || anchorText.includes('request info'))) profile.actionUrls.testRide = buildUrl(href);
    if ((safeHref.match(/\/(staff|team|about-us)\b/) || anchorText.includes('meet the team') || anchorText.includes('staff')) && !profile.actionUrls.staff) profile.actionUrls.staff = buildUrl(href);
    if ((safeHref.match(/\/(blog|news|articles)\b/)) && !profile.actionUrls.blog) profile.actionUrls.blog = buildUrl(href);
    if ((safeHref.match(/\/(events|calendar|shows)\b/) || anchorText.includes('events') || anchorText.includes('shows')) && !profile.actionUrls.events) {
      profile.actionUrls.events = buildUrl(href);
    }

    if (
      safeHref.includes('search.google.com/local/writereview') || 
      safeHref.includes('business.google.com/reviews') || 
      safeHref.includes('g.page') || 
      safeHref.includes('g.co/kgs') || 
      safeHref.includes('lrd=') ||
      safeHref.includes('placeid=') ||
      (safeHref.includes('google') && (safeHref.includes('review') || anchorText.includes('review'))) ||
      anchorText.includes('review us on google')
    ) {
      profile.actionUrls.googleReviews = href;
    }

    if (!profile.actionUrls.googleReviews && safeOnclick.includes('g.page/r/')) {
       const extractedUrl = onclick.match(/(?:window\.open|location\.href)\s*\(\s*['"](.*?)['"]/i);
       if (extractedUrl && extractedUrl[1]) profile.actionUrls.googleReviews = extractedUrl[1];
    }
  });

  if (!profile.actionUrls.googleReviews) {
    $('script').each((_, el) => {
      const src = $(el).attr('src')?.toLowerCase() || '';
      if (src.includes('elfsight.com') || src.includes('podium.com') || src.includes('birdeye.com') || src.includes('customerlobby.com') || src.includes('reputation.com')) {
        profile.actionUrls.googleReviews = `Widget Script Installed (${src})`;
      }
    });
  }

  // --- 8. RAW HTML SCRIPT GPS EXTRACTION ---
  if (!profile.latitude || !profile.longitude) {
    const rawGeoMatch = rawHtmlString.match(/(?:lat|latitude)["'\s:=]+(-?\d{2}\.\d{3,})["',\s]+(?:lng|lon|longitude)["'\s:=]+(-?\d{2,3}\.\d{3,})/i);
    if (rawGeoMatch) {
      profile.latitude = rawGeoMatch[1];
      profile.longitude = rawGeoMatch[2];
    }
  }

  $('iframe[src*="maps.google"], iframe[src*="google.com/maps"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !profile.googleBusinessUrl) {
      profile.googleBusinessUrl = src;
      const geoMatch = src.match(GOOGLE_MAPS_GEO_REGEX);
      if (geoMatch) { profile.longitude = geoMatch[1]; profile.latitude = geoMatch[2]; }
    }
  });

  return profile;
}

// ============================================================================
// 7. URL DEDUPLICATION AND LINK EXTRACTION
// ============================================================================
export function parseAndExtractLinks(htmlOrSelector, currentUrl, targetUrl, targetDomain, session, currentDepth) {
  const $ = typeof htmlOrSelector === 'function' ? htmlOrSelector : cheerio.load(htmlOrSelector);
  const elements = $('a').toArray();

  for (const element of elements) {
    if (session.isTerminated) break;
    if (session.discoveredLinks.length >= 10000) { session.queue = []; break; }

    const href = $(element).attr('href');
    if (!href) continue;

    try {
      const absoluteUrl = new URL(href, currentUrl);
      const urlString = absoluteUrl.toString();

      if (urlString.includes('javascript:') || urlString.endsWith('#')) continue;
      
      const cleanUrl = canonicalizeUrl(urlString);

      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) continue;
      if (isAssetUrl(cleanUrl)) continue;
      if (getCleanDomain(cleanUrl) !== targetDomain) continue;

      let anchorText = $(element).text().trim();
      if (!anchorText) {
        const innerImg = $(element).find('img');
        anchorText = innerImg.length ? $(innerImg).attr('alt')?.trim() || '[Image Link]' : '[No Text]';
      }

      // Drop query parameters for deduplication key so ?page=1 doesn't duplicate
      let dedupeKey = cleanUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();
      if (!dedupeKey.includes('page=') && !dedupeKey.includes('p=')) {
          dedupeKey = dedupeKey.split('?')[0]; 
      }

      if (!session.seenUniqueLinks.has(dedupeKey)) {
        session.seenUniqueLinks.add(dedupeKey);
        
        const { category, subCategory } = categorizeLink(cleanUrl, 200);
        const autoDetails = extractAutoDetails(cleanUrl);

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
          if (!session.visitedUrls.has(cleanUrl)) {
            session.queue.push({ url: cleanUrl, depth: currentDepth + 1 });
          }
        }
      }
    } catch (e) {}
  }
}