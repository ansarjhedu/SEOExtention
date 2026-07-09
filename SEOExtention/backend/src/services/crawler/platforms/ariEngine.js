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
    if (pathname.match(/^\/oemparts\/.+/)) return true;
    if (pathname.match(/^\/parts\/.+/)) return true;
    if (pathname.match(/^\/arinet\/.+/)) return true;
    
    if (pathname.includes('/catalog/') || pathname.includes('/showrooms/')) {
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length > 3) return true; 
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

  if (statusCode === 404 || pathname.includes('/404') || pathname.includes('page-not-found')) {
    return { category: 'dead_link', subCategory: '404-error' };
  }

  if (pathname.match(/\/(blog|news|article|articles)/)) return { category: 'blog', subCategory: 'article' };
  if (pathname.match(/\/(parts|accessories|parts-department|order-parts)/)) return { category: 'page', subCategory: 'parts-page' };
  if (pathname.match(/\/(service|service-department|schedule-service)/)) return { category: 'page', subCategory: 'service-page' };
  if (pathname.match(/\/(promotions?|promo|special-offers|specials|current-offers|factory-promotions|sales-events|offers)/)) return { category: 'page', subCategory: 'promotion-page' };
  if (pathname.match(/\/(testimonial|reviews|customer-feedback)/)) return { category: 'page', subCategory: 'testimonials' };
  if (pathname.match(/\/(events|calendar|shows)/)) return { category: 'page', subCategory: 'events' };

  const hasInventoryID = /-\d{5,}\/?$/.test(pathname);
  
  if ((pathname.includes('/inventory/v1/') || pathname.includes('/inventory/')) && !hasInventoryID) {
    return { category: 'inventory', subCategory: 'category-inventory' }; 
  }

  const isProduct = (pathname.includes('/inventory/') || pathname.includes('/product/')) && hasInventoryID;
  if (isProduct) {
    const isUsed = pathname.includes('pre-owned') || pathname.includes('used');
    return { category: 'product', subCategory: isUsed ? 'used-product' : 'new-product' };
  }

  if (pathname.match(/\/(inventory|search|all-inventory|vehicles|rv-search)/)) {
    let subCategory = 'general-inventory';
    if (pathname.includes('/new')) subCategory = 'new-inventory';
    else if (pathname.includes('pre-owned') || pathname.includes('used')) subCategory = 'used-inventory';
    return { category: 'inventory', subCategory };
  }

  if (pathname.match(/\/(brands?|showrooms?|manufacturer-models|oem-models|catalogs?|manufacturers?|model-list)/) || hasBrandSegment) {
    return { category: 'collection', subCategory: 'brand-directory' };
  }

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
  if (currentDepth >= 5) return false; 
  if (shouldIgnoreLink(urlStr)) return false;
  return true;
}

// ============================================================================
// 5. ARI METADATA & MULTI-TIER PRICE EXTRACTION
// ============================================================================
export function extractPageMetadata(htmlOrSelector) {
  const $ = typeof htmlOrSelector === 'function' ? htmlOrSelector : cheerio.load(htmlOrSelector);
  
  let extractedPrice = '';
  let priceType = '';
  let msrp = '';
  let retailPrice = '';
  let salePrice = '';
  let sellingPrice = '';
  let monthlyPayment = '';
  let specs = '';
  let year = '', brandName = '', modelName = '', vehicleType = 'Vehicle';

  // 1. EXTRACT INFO & SPECIFICATIONS
  const specsRaw = $('.specs, .specifications, #specs, table.spec, .details-container, .vehicle-features, .srp-vehicle-details, .item-details').text().replace(/\s+/g, ' ').trim();
  if (specsRaw) specs = specsRaw.substring(0, 1500);

  // 2. STRICT TABULAR PRICE PARSING (Ignores Paragraphs)
  $('tr, li, dt, .price-row, .price-line, dl, .pricing-detail, div').each((_, el) => {
      const rowText = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
      
      // Prevent reading giant marketing paragraphs
      if (rowText.length > 120 || rowText.includes('ranging from') || rowText.includes('starting at')) return;

      const priceMatch = rowText.match(/\$\s*([1-9]\d{0,2}(?:,\d{3})*(?:\.\d{2})?)\b/);
      if (priceMatch) {
          const amt = `$${priceMatch[1]}`;
          if (rowText.includes('retail price')) retailPrice = amt;
          else if (rowText.includes('selling price')) sellingPrice = amt;
          else if (rowText.includes('sale price') || rowText.includes('our price') || rowText.includes('internet price')) salePrice = amt;
          else if (rowText.includes('msrp')) msrp = amt;
          else if (rowText.includes('/mo') || rowText.includes('per month')) monthlyPayment = `${amt}/mo`;
      }
  });

  // 3. SCHEMA FALLBACK
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if ((item['@type'] === 'Product' || item['@type'] === 'Vehicle') && item.offers && item.offers.price) {
            if (parseFloat(item.offers.price) > 0 && !msrp) {
              msrp = `$${Number(item.offers.price).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            }
        }
      }
    } catch (e) {}
  });

  let metaDescription = $('meta[name="description"]').attr('content') || '';

  // 4. DETERMINE PRIMARY PRICE TAG HIERARCHY
  if (sellingPrice) {
      extractedPrice = sellingPrice;
      priceType = 'Selling Price';
  } else if (salePrice) {
      extractedPrice = salePrice;
      priceType = 'Sale / Our Price';
  } else if (retailPrice) {
      extractedPrice = retailPrice;
      priceType = 'Retail Price';
  } else if (msrp) {
      extractedPrice = msrp;
      priceType = 'MSRP';
  }

  // 5. BLIND FALLBACK FOR NAKED DOLLARS (With strict length limit)
  if (!extractedPrice) {
      $('[class*="price" i], [id*="price" i], .unit-price, .veh-price').each((_, el) => {
          if (extractedPrice) return;
          const text = $(el).text().replace(/\s+/g, ' ').trim();
          if (text.length > 50) return; 
          const priceMatch = text.match(/\$\s*([1-9]\d{0,2}(?:,\d{3})*(?:\.\d{2})?)\b/);
          if (priceMatch) {
              extractedPrice = `$${priceMatch[1]}`;
              priceType = 'Listed Price';
          }
      });
  }

  // 6. METADATA EXTRACTION
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

  return { price: extractedPrice, priceType, msrp, retailPrice, salePrice, sellingPrice, monthlyPayment, specs, year, brandName, modelName, vehicleType, metaDescription };
}

// ============================================================================
// 6. STRICT ENTITY, DEEP TEXT & HOURS EXTRACTION
// ============================================================================
export function extractDealershipProfile(htmlOrSelector, currentUrl) {
  const $ = typeof htmlOrSelector === 'function' ? htmlOrSelector : cheerio.load(htmlOrSelector);
  const rawHtmlString = typeof htmlOrSelector === 'string' ? htmlOrSelector : $.html();

  const profile = {
    dealershipName: '', legalCorporateName: '', dbaAlternateName: '', streetAddress: '',
    city: '', state: '', zipCode: '', telephoneMainLine: '', telephoneFax: '', 
    latitude: '', longitude: '', googleBusinessUrl: '', logoUrl: '', platform: 'ARI',
    socialLinks: { facebook: '', instagram: '', youtube: '', twitter: '', tiktok: '', linkedin: '' },
    requiredUrls: { parts: '', service: '', finance: '', bodyShop: '', careers: '' }, 
    actionUrls: { serviceScheduler: '', partsRequest: '', tradeIn: '', testRide: '', staff: '', blog: '', events: '', testimonials: '', googleReviews: '', financeApp: '', partsDiagrams: '', warrantyRecall: '' },
    departmentPhones: { sales: '', service: '', parts: '' },
    storeHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' },
    serviceHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' }, 
    financeDetails: { lendingPartners: [], programsOffered: [], financingLanguage: '' },
    serviceDetails: { tiers: [], claims: [], brandsServiced: [], nonFranchiseAccepted: false, unitAgeLimitations: '' },
    partsDetails: { oemSupport: false, aftermarketSupport: false, specialOrders: false },
    bodyShopDetails: { servicesOffered: [], paintServices: false }
  };

  const pageText = $('body').text().replace(/\s+/g, ' ').toLowerCase();
  const currentUrlLower = currentUrl.toLowerCase();

  // 1. DEEP TEXT MINING PER SPEC
  if (currentUrlLower.includes('financ') || currentUrlLower.includes('credit') || currentUrlLower.includes('promo')) {
      const lenders = ['sheffield', 'synchrony', 'octane', 'roadrunner', 'eaglemark', 'motolease', 'first community', 'freedom', 'yamaha financial', 'polaris financial'];
      lenders.forEach(lender => {
          if (pageText.includes(lender)) profile.financeDetails.lendingPartners.push(lender.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
      });
      const aprMatch = pageText.match(/.{0,40}\b(?:apr|months|down payment)\b.{0,40}/i);
      if (aprMatch && !profile.financeDetails.financingLanguage) profile.financeDetails.financingLanguage = aprMatch[0].trim();
  }
  if (currentUrlLower.includes('service')) {
      const repairs = ['tune-up', 'winterization', 'oil change', 'tire installation', 'tire repair', 'diagnostics', 'engine rebuild', 'maintenance', 'inspection', 'battery', 'brake'];
      repairs.forEach(repair => {
          if (pageText.includes(repair)) profile.serviceDetails.claims.push(repair.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
      });
      if (pageText.includes('service all makes') || pageText.includes('work on all brands') || pageText.includes('any brand')) profile.serviceDetails.nonFranchiseAccepted = true;
      const ageMatch = pageText.match(/.{0,30}\b(?:years or older|newer than|older than 10)\b.{0,30}/i);
      if (ageMatch) profile.serviceDetails.unitAgeLimitations = ageMatch[0].trim();
  }
  if (currentUrlLower.includes('part') || currentUrlLower.includes('accessories')) {
      if (pageText.includes('oem') || pageText.includes('original equipment')) profile.partsDetails.oemSupport = true;
      if (pageText.includes('aftermarket') || pageText.includes('accessories')) profile.partsDetails.aftermarketSupport = true;
      if (pageText.includes('special order') || pageText.includes('hard to find')) profile.partsDetails.specialOrders = true;
  }
  if (currentUrlLower.includes('body') || currentUrlLower.includes('collision')) {
      if (pageText.includes('paint') || pageText.includes('color match')) profile.bodyShopDetails.paintServices = true;
      if (pageText.includes('collision') || pageText.includes('dent')) profile.bodyShopDetails.servicesOffered.push('Collision Repair');
  }

  // 2. LOGO AND SCHEMA MAPPING
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
        }
      }
    } catch (e) {}
  });

  if (!profile.dealershipName) {
    profile.dealershipName = $('meta[property="og:site_name"]').attr('content') || $('meta[name="author"]').attr('content') || '';
    if (!profile.dealershipName || profile.dealershipName.length > 60) {
      const rawTitle = $('title').first().text();
      let cleanTitle = rawTitle.split(/\||-/)[0].trim();
      if (cleanTitle && cleanTitle.length < 60) profile.dealershipName = cleanTitle;
    }
  }

  if (!profile.legalCorporateName || profile.legalCorporateName.length > 60) {
    const footerText = $('footer, .footer, #footer, .site-footer, .copyright').text().replace(/\s+/g, ' ');
    const cpMatch = footerText.match(/(?:©|Copyright)\s*(?:20\d{2}(?:\s*-\s*20\d{2})?)?\s*([^|•\-.,]+?(?:LLC|Inc\.?|Corp\.?|Ltd\.?)?)(?=\s+\||All Rights|Privacy|Terms|Website|Powered|$)/i);
    
    if (cpMatch && cpMatch[1]) {
      let name = cpMatch[1].replace(/all rights reserved/ig, '').replace(/powered by ari/ig, '').replace(/website by.*/ig, '').trim();
      if (name.length > 2 && name.length < 60) profile.legalCorporateName = name;
    }
  }

  // ============================================================================
  // 3. ADVANCED LINEAR HOURS PARSER (Sibling Syphons & Range Algorithims)
  // ============================================================================
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const getDayIndex = (str) => {
      const d = str.toLowerCase();
      if (d.startsWith('m')) return 0; if (d.startsWith('tu')) return 1; if (d.startsWith('w')) return 2;
      if (d.startsWith('th')) return 3; if (d.startsWith('f')) return 4; if (d.startsWith('sa')) return 5;
      if (d.startsWith('su')) return 6; return -1;
  };
  const customClosedRegex = /(gone riding|gone to church|out riding)/gi;

  $('tr, li, p, dt, div').each((_, el) => {
    if ($(el).is('div') && $(el).find('tr, li, p, dl, dt').length > 0) return;

    let rawLine = $(el).text().replace(/\s+/g, ' ').trim();
    
    if (el.tagName.toLowerCase() === 'dt') {
        let ddText = $(el).next('dd').text().replace(/\s+/g, ' ').trim();
        if (ddText) rawLine += ' ' + ddText;
    } else {
        const dayOnlyRegex = /^(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|thr|friday|fri|saturday|sat|sunday|sun)(?:\s*(?:-|to|thru|and|&)\s*(?:monday|mon|tuesday|tue|wednesday|wed|thursday|thu|thr|friday|fri|saturday|sat|sunday|sun))?[\s:-]*$/i;
        if (dayOnlyRegex.test(rawLine) && $(el).next().length) {
            let nextText = $(el).next().text().replace(/\s+/g, ' ').trim();
            if (/(\d|closed|gone)/i.test(nextText)) rawLine += ' ' + nextText;
        }
    }

    if (customClosedRegex.test(rawLine)) rawLine = rawLine.replace(customClosedRegex, 'Closed');
    const lineLower = rawLine.toLowerCase();
    
    if (lineLower.length > 3 && lineLower.length < 90 && /(\d|closed)/.test(lineLower)) {
      const dayRegex = /\b(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|thr|friday|fri|saturday|sat|sunday|sun)\b/gi;
      let matches = [...lineLower.matchAll(dayRegex)];
      
      if (matches.length > 0) {
          let timeString = rawLine.replace(dayRegex, '').replace(/^[&,\-:\s(to)(thru)(and)]+/i, '').trim();
          timeString = timeString.replace(/^[^a-zA-Z0-9]+/, '').trim();
          if (timeString.toLowerCase().includes('closed') || timeString === '') timeString = 'Closed';

          let affectedDays = new Set();
          
          const rangeMatch = lineLower.match(/\b(mon|tue|wed|thu|thr|fri|sat|sun)[a-z]*\s*(?:-|to|thru)\s*(mon|tue|wed|thu|thr|fri|sat|sun)[a-z]*\b/i);
          if (rangeMatch) {
              let startIdx = getDayIndex(rangeMatch[1]);
              let endIdx = getDayIndex(rangeMatch[2]);
              if (startIdx !== -1 && endIdx !== -1) {
                  if (startIdx <= endIdx) {
                      for (let i = startIdx; i <= endIdx; i++) affectedDays.add(dayNames[i]);
                  } else { 
                      for (let i = startIdx; i <= 6; i++) affectedDays.add(dayNames[i]);
                      for (let i = 0; i <= endIdx; i++) affectedDays.add(dayNames[i]);
                  }
              }
          } else {
              matches.forEach(m => {
                  const idx = getDayIndex(m[0]);
                  if (idx !== -1) affectedDays.add(dayNames[idx]);
              });
          }

          const dlParent = $(el).closest('dl, ul, table');
          const divParent = $(el).closest('div[class*="hour" i], div[class*="time" i], section, .footer-column');
          const headings = dlParent.prevAll('h1, h2, h3, h4, h5, strong, .title').text() + ' ' + divParent.prevAll('h1, h2, h3, h4, h5, strong, .title, .footer-column__header').text();
          const classNames = (dlParent.attr('class') || '') + ' ' + (divParent.attr('class') || '');
          const localHeading = $(el).closest('dl').prev('h4, h3, strong').text();

          const fullContext = (headings + ' ' + classNames + ' ' + localHeading).toLowerCase();
          
          affectedDays.forEach(day => {
              if ((fullContext.includes('service') || fullContext.includes('parts') || fullContext.includes('inspection')) && !fullContext.includes('sales') && !fullContext.includes('store')) {
                  if (!profile.serviceHours[day]) profile.serviceHours[day] = timeString;
              } else {
                  if (!profile.storeHours[day]) profile.storeHours[day] = timeString;
              }
          });
      }
    }
  });

  // 4. ACTION URLS & ANCHORS
  $('a, button, div.review-btn').each((_, el) => {
    const href = $(el).attr('href') || '';
    const onclick = $(el).attr('onclick') || ''; 
    const anchorText = $(el).text().toLowerCase().trim();
    const targetLink = (href.toLowerCase() + ' ' + onclick.toLowerCase());

    if (!targetLink || targetLink.trim() === '' || targetLink.includes('javascript:void(0)')) return;
    if (href === '#' || href === '/' || href.startsWith('javascript:')) return;

    const buildUrl = (path) => { try { return new URL(path, currentUrl).toString(); } catch { return path; } };
    let absoluteLink = href.startsWith('/') ? buildUrl(href).toLowerCase() : href.toLowerCase();

    if (targetLink.includes('facebook.com/') && !profile.socialLinks.facebook) profile.socialLinks.facebook = href;
    if (targetLink.includes('instagram.com/') && !profile.socialLinks.instagram) profile.socialLinks.instagram = href;
    if (targetLink.includes('youtube.com/') && !profile.socialLinks.youtube) profile.socialLinks.youtube = href;
    if ((targetLink.includes('twitter.com/') || targetLink.includes('x.com/')) && !profile.socialLinks.twitter) profile.socialLinks.twitter = href;
    if (targetLink.includes('tiktok.com/') && !profile.socialLinks.tiktok) profile.socialLinks.tiktok = href;
    if (targetLink.includes('linkedin.com/') && !profile.socialLinks.linkedin) profile.socialLinks.linkedin = href;

    if (!profile.requiredUrls.parts && (absoluteLink.match(/\/(parts-department|parts|accessories)\b/) || anchorText.includes('parts department') || anchorText === 'parts') && !absoluteLink.includes('diagram') && !absoluteLink.includes('request')) profile.requiredUrls.parts = buildUrl(href);
    if (!profile.requiredUrls.service && (absoluteLink.match(/\/(service-department|service|repair)\b/) || anchorText.includes('service department') || anchorText === 'service') && !absoluteLink.includes('schedule')) profile.requiredUrls.service = buildUrl(href);
    if (!profile.requiredUrls.finance && (absoluteLink.match(/\/(finance-application|finance|financing|credit)\b/) || anchorText.includes('finance') || anchorText.includes('financing')) && !absoluteLink.includes('app')) profile.requiredUrls.finance = buildUrl(href);
    if ((absoluteLink.includes('body-shop') || absoluteLink.includes('collision')) && !profile.requiredUrls.bodyShop) profile.requiredUrls.bodyShop = buildUrl(href);
    if ((absoluteLink.includes('career') || absoluteLink.includes('employment')) && !profile.requiredUrls.careers) profile.requiredUrls.careers = buildUrl(href);

    if ((absoluteLink.includes('schedule') || absoluteLink.includes('appointment')) && !absoluteLink.includes('ride') && !absoluteLink.includes('drive') && !profile.actionUrls.serviceScheduler) {
         profile.actionUrls.serviceScheduler = buildUrl(href);
    }
    if (absoluteLink.includes('parts-request') && !profile.actionUrls.partsRequest) profile.actionUrls.partsRequest = buildUrl(href);
    if ((absoluteLink.includes('value-your-trade') || absoluteLink.includes('trade-in')) && !profile.actionUrls.tradeIn) profile.actionUrls.tradeIn = buildUrl(href);
    if ((absoluteLink.includes('test-ride') || absoluteLink.includes('schedule-ride')) && !profile.actionUrls.testRide) profile.actionUrls.testRide = buildUrl(href);
    if (absoluteLink.includes('finance-app') || absoluteLink.includes('credit-application') || absoluteLink.includes('credit_app')) profile.actionUrls.financeApp = buildUrl(href);
    if (absoluteLink.includes('parts-diagram') || absoluteLink.includes('fiche') || absoluteLink.includes('oemparts')) profile.actionUrls.partsDiagrams = buildUrl(href);
    if (absoluteLink.includes('warranty') || absoluteLink.includes('recall')) profile.actionUrls.warrantyRecall = buildUrl(href);

    if ((absoluteLink.match(/\/(staff|team|about-us)\b/) || anchorText.includes('meet the team') || anchorText.includes('staff')) && !profile.actionUrls.staff) profile.actionUrls.staff = buildUrl(href);
    if ((absoluteLink.match(/\/(blog|news|articles)\b/)) && !profile.actionUrls.blog) profile.actionUrls.blog = buildUrl(href);
    if ((absoluteLink.match(/\/(events|calendar|shows)\b/) || anchorText.includes('events') || anchorText.includes('shows')) && !profile.actionUrls.events) profile.actionUrls.events = buildUrl(href);

    if (
      absoluteLink.includes('search.google.com/local/writereview') || 
      absoluteLink.includes('business.google.com/reviews') || 
      absoluteLink.includes('g.page') || 
      absoluteLink.includes('g.co/kgs') || 
      absoluteLink.includes('lrd=') ||
      absoluteLink.includes('placeid=') ||
      (absoluteLink.includes('google') && (absoluteLink.includes('review') || anchorText.includes('review'))) ||
      anchorText.includes('review us on google')
    ) {
      profile.actionUrls.googleReviews = href;
    }

    if (!profile.actionUrls.googleReviews && onclick.toLowerCase().includes('g.page/r/')) {
       const extractedUrl = onclick.match(/(?:window\.open|location\.href)\s*\(\s*['"](.*?)['"]/i);
       if (extractedUrl && extractedUrl[1]) profile.actionUrls.googleReviews = extractedUrl[1];
    }
  });

  // 5. REVIEW IFRAME & WIDGET INTEGRATION
  if (!profile.actionUrls.googleReviews) {
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || '';
      const lowerSrc = src.toLowerCase();
      if (
        lowerSrc.includes('elfsight.com') || lowerSrc.includes('trustindex.io') || 
        lowerSrc.includes('embedsocial.com') || lowerSrc.includes('reviews.io') || 
        lowerSrc.includes('socius') || (lowerSrc.includes('review') && !lowerSrc.includes('youtube.com')) 
      ) {
        profile.actionUrls.googleReviews = `Review iFrame Detected: ${src}`;
      }
    });
  }
  if (!profile.actionUrls.googleReviews) {
    $('script').each((_, el) => {
      const src = $(el).attr('src')?.toLowerCase() || '';
      if (src.includes('elfsight.com') || src.includes('podium.com') || src.includes('birdeye.com') || src.includes('broadly.com')) {
         profile.actionUrls.googleReviews = `Widget Script Installed (${src})`;
      }
    });
  }

  // 6. PHONE & GPS CAPTURE
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
          price: '', priceType: '', msrp: '', retailPrice: '', salePrice: '', sellingPrice: '', monthlyPayment: '', specs: '',
          year: autoDetails.year || '',
          brandName: autoDetails.brandName || '',
          modelName: autoDetails.modelName || '',
          vehicleType: autoDetails.vehicleType || 'Vehicle', 
          verificationStatus: category === 'product' ? 'MISSING' : 'VERIFIED'
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