// services/crawler/platforms/interactRvEngine.js

import * as cheerio from 'cheerio';
import { getCleanDomain, isAssetUrl, canonicalizeUrl } from '../utils.js';

// ============================================================================
// PERFORMANCE: Globally pre-compiled Regex definitions & Configs
// ============================================================================
const YEAR_HEADER_REGEX = /\b(19[8-9]\d|20[0-2]\d)\b/;
const PRICE_TEXT_REGEX = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/;
const PHONE_EXTRACT_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const GOOGLE_MAPS_GEO_REGEX = /!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/;

const KNOWN_RV_BRANDS = [
  'jayco', 'forest river', 'forest-river', 'grand design', 'grand-design', 'keystone', 'thor', 'winnebago', 
  'coachmen', 'airstream', 'fleetwood', 'newmar', 'tiffin', 'dutchmen', 'heartland', 'crossroads', 
  'cruiser-rv', 'cruiser rv', 'palomino', 'entegra', 'lance', 'gulf stream', 'gulf-stream', 'holiday rambler', 
  'holiday-rambler', 'monaco', 'starcraft', 'highland ridge', 'highland-ridge', 'alliance', 'brinkley'
];

const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// ============================================================================
// 1. INTERACT RV SPECIFIC URL CATEGORIZATION LOGIC
// ============================================================================
export function categorizeLink(urlStr) {
  const urlLower = urlStr.toLowerCase();
  let category = 'page';
  let subCategory = 'static';

  let pathname = '';
  try {
    pathname = new URL(urlStr).pathname.toLowerCase();
  } catch(e) {
    pathname = urlLower;
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  const hasBrandSegment = pathSegments.some(seg => KNOWN_RV_BRANDS.includes(seg) || KNOWN_RV_BRANDS.includes(seg.replace(/-/g, ' ')));

  // TIER 1: Explicit Functional Pages
  if (urlLower.match(/\/(blog|news|article|articles)/)) return { category: 'blog', subCategory: 'article' };
  if (urlLower.match(/\/(parts|rv-parts|parts-department|order-parts|accessories)/)) return { category: 'page', subCategory: 'parts-page' };
  if (urlLower.match(/\/(service|rv-service|schedule-service|service-department)/)) return { category: 'page', subCategory: 'service-page' };
  if (urlLower.match(/\/(specials|rv-specials|clearance|promotions|offers|sales-events)/)) return { category: 'page', subCategory: 'promotion-page' };
  if (urlLower.match(/\/(testimonial|reviews|customer-feedback)/)) return { category: 'page', subCategory: 'testimonials' };
  if (urlLower.match(/\/(events|calendar|rv-shows|shows)/)) return { category: 'page', subCategory: 'events' };

  // TIER 1.5: THE DISGUISED CATEGORY SHIELD
  const hasYear = YEAR_HEADER_REGEX.test(pathname);
  const hasID = /-\d{4,}/.test(pathname); 

  if ((pathname.includes('/product/') || pathname.includes('/rv/')) && !hasYear && !hasID) {
    return { category: 'inventory', subCategory: 'category-inventory' };
  }

  // TIER 2: Product VDPs
  const isProduct = 
    pathname.includes('/product/') || 
    pathname.includes('/rv/') || 
    (pathname.includes('-inventory-') && hasYear) ||
    (pathSegments.length > 2 && /\b(?:19|20)\d{2}\b/.test(pathSegments[pathSegments.length - 1]));

  if (isProduct) {
    category = 'product';
    subCategory = urlLower.includes('pre-owned') || urlLower.includes('used') ? 'used-product' : 'new-product';
    return { category, subCategory };
  } 

  // TIER 3: Inventory Hubs
  if (urlLower.match(/\/(rv-search|inventory|new-rvs|used-rvs|rvs-for-sale|search-rvs|all-inventory)/)) {
    category = 'inventory';
    subCategory = urlLower.includes('used') || urlLower.includes('pre-owned') ? 'used-inventory' : 'new-inventory';
    return { category, subCategory };
  } 
  if (urlLower.match(/\/(travel-trailers|fifth-wheels|motorhomes|toy-haulers|pop-up-campers|truck-campers)/)) {
    category = 'inventory'; 
    subCategory = 'category-inventory';
    return { category, subCategory };
  }

  // TIER 4: Brands & Showrooms
  if (urlLower.match(/\/(brands|manufacturers|rv-brands|showrooms|manufacturer-models)/) || hasBrandSegment) {
    category = 'collection'; 
    subCategory = 'brand-directory';
    return { category, subCategory };
  } 

  return { category, subCategory };
}

// ============================================================================
// 2. INTERACT RV SPECIFIC URL DETAIL EXTRACTION LOGIC
// ============================================================================
export function extractAutoDetails(urlStr) {
  const details = { year: '', brandName: '', modelName: '', vehicleType: 'RV' };
  try {
    const urlObj = new URL(urlStr);
    const lowerUrl = urlObj.pathname.toLowerCase();

    if (lowerUrl.includes('travel-trailer') || lowerUrl.includes('traveltrailer')) details.vehicleType = 'Travel Trailer';
    else if (lowerUrl.includes('fifth-wheel') || lowerUrl.includes('fifthwheel') || lowerUrl.includes('5th-wheel')) details.vehicleType = 'Fifth Wheel';
    else if (lowerUrl.includes('motorhome') || lowerUrl.includes('class-a') || lowerUrl.includes('class-c') || lowerUrl.includes('class-b')) details.vehicleType = 'Motorhome';
    else if (lowerUrl.includes('toy-hauler') || lowerUrl.includes('toyhauler')) details.vehicleType = 'Toy Hauler';
    else if (lowerUrl.includes('pop-up') || lowerUrl.includes('folding-camper')) details.vehicleType = 'Pop Up Camper';
    else if (lowerUrl.includes('truck-camper')) details.vehicleType = 'Truck Camper';
    else if (lowerUrl.includes('destination-trailer')) details.vehicleType = 'Destination Trailer';

    const yearMatch = lowerUrl.match(/\b((?:19|20)\d{2})\b/);
    if (yearMatch) details.year = yearMatch[1];

    for (const b of KNOWN_RV_BRANDS) {
      const normalizedBrand = b.replace(/-/g, ' ');
      if (lowerUrl.includes(b) || lowerUrl.includes(normalizedBrand.replace(/ /g, '-'))) {
        details.brandName = normalizedBrand.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        break;
      }
    }
  } catch (e) {}
  return details;
}

// ============================================================================
// 3. INTERACT RV CRAWLABLE PATH VALIDATION (Updated for Pagination)
// ============================================================================
export function isCrawlablePath(urlStr, currentDepth = 0) {
  if (currentDepth >= 5) return false; // Allowed slightly deeper penetration for pagination

  const lowerUrl = urlStr.toLowerCase();
  
  const blacklistDirectories = [
    '/gallery', '/social', '/widget', '/forum', '/job', '/career', '/employment', 
    '/cart', '/checkout', '/account', '/privacy', '/terms', 
    'print=true', '/send-to-friend', '/payment-calculator', '/value-your-trade'
  ];

  if (blacklistDirectories.some(dir => lowerUrl.includes(dir))) return false; 
  return true;
}

// ============================================================================
// 4. INTERACT RV METADATA & PRICE EXTRACTION (Surgical Fix)
// ============================================================================
export function extractPageMetadata(htmlOrSelector) {
  const $ = typeof htmlOrSelector === 'function' ? htmlOrSelector : cheerio.load(htmlOrSelector);
  let extractedPrice = '';
  let potentialPrices = [];

  // 1. JSON-LD Extraction (Safest layer)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if ((item['@type'] === 'Product' || item['@type'] === 'Vehicle' || item['@type'] === 'RV') && item.offers && item.offers.price) {
            if (parseFloat(item.offers.price) > 0) {
              potentialPrices.push(parseFloat(item.offers.price));
            }
        }
      }
    } catch (e) {}
  });

  // 2. Strict DOM Hierarchy Price Scanner (Focuses on "Our Price" and "Sale Price")
  const discountSelectors = ['.our-price', '.sale-price', '.internet-price', '.final-price', '[data-price]'];
  for (const selector of discountSelectors) {
    const rawText = $(selector).text().replace(/\s+/g, ' ').trim();
    const priceMatch = rawText.match(PRICE_TEXT_REGEX);
    if (priceMatch) {
      const parsedVal = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (parsedVal > 1000) potentialPrices.push(parsedVal);
    }
  }

  // 3. Fallback to general price and MSRP
  if (potentialPrices.length === 0) {
    const generalSelectors = ['.price', '.msrp', '.rv-price', '.unit-price'];
    for (const selector of generalSelectors) {
      const rawText = $(selector).first().text().replace(/\s+/g, ' ').trim();
      const priceMatch = rawText.match(PRICE_TEXT_REGEX);
      if (priceMatch) {
        const parsedVal = parseFloat(priceMatch[1].replace(/,/g, ''));
        if (parsedVal > 1000) potentialPrices.push(parsedVal);
      }
    }
  }

  // Choose the lowest logical valid price to represent "Our Price" accurately 
  if (potentialPrices.length > 0) {
    const minPrice = Math.min(...potentialPrices);
    extractedPrice = `$${minPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
  }

  let year = '', brandName = '', modelName = '', vehicleType = 'RV';
  const vdpHeader = $('h1, .product-title, .rv-title, .unit-title, .vdp-title').first().text().replace(/\s+/g, ' ').trim();
  
  if (vdpHeader) {
    const yearMatch = vdpHeader.match(YEAR_HEADER_REGEX);
    if (yearMatch) year = yearMatch[1];

    const lowerHeader = vdpHeader.toLowerCase();

    if (lowerHeader.includes('travel trailer')) vehicleType = 'Travel Trailer';
    else if (lowerHeader.includes('fifth wheel') || lowerHeader.includes('5th wheel')) vehicleType = 'Fifth Wheel';
    else if (lowerHeader.includes('motorhome') || lowerHeader.includes('class a') || lowerHeader.includes('class c') || lowerHeader.includes('class b')) vehicleType = 'Motorhome';
    else if (lowerHeader.includes('toy hauler')) vehicleType = 'Toy Hauler';
    else if (lowerHeader.includes('pop up') || lowerHeader.includes('folding camper')) vehicleType = 'Pop Up Camper';
    else if (lowerHeader.includes('truck camper')) vehicleType = 'Truck Camper';
    else if (lowerHeader.includes('destination trailer')) vehicleType = 'Destination Trailer';
    
    for (const b of KNOWN_RV_BRANDS) {
      const cleanB = b.replace(/-/g, ' ');
      if (lowerHeader.includes(cleanB) || lowerHeader.includes(cleanB.replace(/ /g, '-'))) {
        brandName = cleanB.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        
        const brandIndex = lowerHeader.indexOf(cleanB);
        let rawModel = vdpHeader.substring(brandIndex + cleanB.length).trim();
        
        if (year) rawModel = rawModel.replace(new RegExp(`\\b${year}\\b`, 'g'), '').trim();
        rawModel = rawModel.replace(/new|used|for sale|pre-owned/ig, '').trim();
        if (rawModel) modelName = rawModel.replace(/^[-:/,\s]+|[-:/,\s]+$/g, '');
        break;
      }
    }

    if (brandName && !modelName) {
      let fallbackModel = vdpHeader;
      if (year) fallbackModel = fallbackModel.replace(new RegExp(`\\b${year}\\b`, 'g'), '');
      fallbackModel = fallbackModel.replace(new RegExp(brandName, 'ig'), '');
      fallbackModel = fallbackModel.replace(/new|used|for sale|pre-owned/ig, '').trim();
      if (fallbackModel) modelName = fallbackModel.replace(/^[-:/,\s]+|[-:/,\s]+$/g, '');
    }
  }

  return { price: extractedPrice, year, brandName, modelName, vehicleType };
}

// ============================================================================
// 5. STRICT ENTITY & NAP DATA EXTRACTION
// ============================================================================
export function extractDealershipProfile(htmlOrSelector, currentUrl) {
  const $ = typeof htmlOrSelector === 'function' ? htmlOrSelector : cheerio.load(htmlOrSelector);
  const rawHtmlString = typeof htmlOrSelector === 'string' ? htmlOrSelector : $.html();

  const profile = {
    dealershipName: '', legalCorporateName: '', dbaAlternateName: '', streetAddress: '',
    city: '', state: '', zipCode: '', telephoneMainLine: '', telephoneFax: '', 
    latitude: '', longitude: '', googleBusinessUrl: '', logoUrl: '', platform: 'Interact RV',
    socialLinks: { facebook: '', instagram: '', youtube: '', twitter: '' },
    requiredUrls: { parts: '', service: '', finance: '' },
    actionUrls: { serviceScheduler: '', partsRequest: '', tradeIn: '', testRide: '', staff: '', blog: '', events: '', testimonials: '', googleReviews: '' },
    departmentPhones: { sales: '', service: '', parts: '' },
    storeHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' },
    serviceHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' }
  };

  $('header img, img.logo, img[id*="logo"], .site-logo img, .navbar-brand img').each((_, el) => {
    if (!profile.logoUrl) {
      const src = $(el).attr('src');
      if (src && !src.includes('data:image')) profile.logoUrl = new URL(src, currentUrl).toString();
    }
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      let items = data['@graph'] ? data['@graph'] : (Array.isArray(data) ? data : [data]);
      for (const item of items) {
        if (item['@type'] === 'AutoDealer' || item['@type'] === 'LocalBusiness' || item['@type'] === 'Organization') {
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

  if (!profile.legalCorporateName || profile.legalCorporateName.length > 60) {
    const footerText = $('footer, .footer, #footer, .site-footer, .copyright').text().replace(/\s+/g, ' ');
    const cpMatch = footerText.match(/(?:©|Copyright)\s*(?:20\d{2}(?:\s*-\s*20\d{2})?)?\s*([^|•\-.,]+?(?:LLC|Inc\.?|Corp\.?|Ltd\.?)?)(?=\s+\||All Rights|Privacy|Terms|Website|Powered|$)/i);
    
    if (cpMatch && cpMatch[1]) {
      let name = cpMatch[1].replace(/all rights reserved/ig, '').replace(/website by.*/ig, '').trim();
      if (name.length > 2 && name.length < 60) profile.legalCorporateName = name;
    }
  }

  if (!profile.legalCorporateName && profile.dealershipName) {
    profile.legalCorporateName = `${profile.dealershipName} LLC (Assumed)`;
  }

  let currentContext = 'storeHours'; 

  $('.hours, .store-hours, .hours-operation, .contact-info, .department-hours, footer, .footer').each((_, container) => {
    const $clone = $(container).clone();
    $clone.find('a').remove();
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

    if (!profile.requiredUrls.parts && (safeHref.match(/\/(rv-parts|parts-department|parts|accessories)\b/) || anchorText.includes('parts department') || anchorText === 'parts')) profile.requiredUrls.parts = buildUrl(href);
    if (!profile.requiredUrls.service && (safeHref.match(/\/(rv-service|service-department|service|repair)\b/) || anchorText.includes('service department') || anchorText === 'service')) profile.requiredUrls.service = buildUrl(href);
    if (!profile.requiredUrls.finance && (safeHref.match(/\/(rv-financing|finance-application|finance|financing|credit|rv-loans?)\b/) || anchorText.includes('finance') || anchorText.includes('financing'))) profile.requiredUrls.finance = buildUrl(href);

    if (!profile.actionUrls.serviceScheduler && (safeHref.match(/\/(schedule-rv-service|schedule-service|service-appointment|appointment)\b/) || anchorText.includes('schedule service'))) profile.actionUrls.serviceScheduler = buildUrl(href);
    if (!profile.actionUrls.partsRequest && (safeHref.match(/\/(request-parts|parts-request|order-parts)\b/) || anchorText.includes('order parts') || anchorText.includes('request parts'))) profile.actionUrls.partsRequest = buildUrl(href);
    if (!profile.actionUrls.tradeIn && (safeHref.match(/\/(rv-trade-in|value-your-trade|value-your-rv|trade-in|trade)\b/) || anchorText.includes('value your trade') || anchorText.includes('trade in'))) profile.actionUrls.tradeIn = buildUrl(href);
    
    if (!profile.actionUrls.testimonials && (safeHref.match(/\/(testimonial|reviews|customer-feedback)\b/) || anchorText.includes('testimonials') || anchorText.includes('read reviews')) && !safeHref.includes('google')) {
      profile.actionUrls.testimonials = buildUrl(href);
    }
    
    if (!profile.actionUrls.testRide && (safeHref.match(/\/(schedule-tour|request-info|make-an-offer|contact-sales)\b/) || anchorText.includes('schedule a tour') || anchorText.includes('request info') || anchorText.includes('make an offer'))) profile.actionUrls.testRide = buildUrl(href);
    if ((safeHref.match(/\/(staff|team|about-us)\b/) || anchorText.includes('meet the team') || anchorText.includes('staff')) && !profile.actionUrls.staff) profile.actionUrls.staff = buildUrl(href);
    if ((safeHref.match(/\/(blog|news|articles)\b/)) && !profile.actionUrls.blog) profile.actionUrls.blog = buildUrl(href);
    if ((safeHref.match(/\/(events|calendar|shows|rv-shows)\b/) || anchorText.includes('events') || anchorText.includes('shows')) && !profile.actionUrls.events) {
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
// 6. URL DEDUPLICATION AND LINK EXTRACTION
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
      // 1. Resolve to Absolute URL
      const absoluteUrl = new URL(href, currentUrl);
      const urlString = absoluteUrl.toString();

      // 2. Base exclusions: Skip raw query links without a path, hashes, or javascript
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

      // 3. Keep query parameters if they are pagination (e.g. ?page=2), drop them otherwise for deduplication
      let dedupeKey = cleanUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();
      if (!dedupeKey.includes('page=') && !dedupeKey.includes('p=')) {
          dedupeKey = dedupeKey.split('?')[0]; 
      }

      if (!session.seenUniqueLinks.has(dedupeKey)) {
        session.seenUniqueLinks.add(dedupeKey);
        
        const { category, subCategory } = categorizeLink(cleanUrl);
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
          vehicleType: autoDetails.vehicleType || 'RV', 
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