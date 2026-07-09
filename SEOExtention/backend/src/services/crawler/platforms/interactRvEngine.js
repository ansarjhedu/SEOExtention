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
  'holiday-rambler', 'monaco', 'starcraft', 'highland ridge', 'highland-ridge', 'alliance', 'brinkley', 'atc', 'bontrager'
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
    pathname = new URL(urlStr).pathname.toLowerCase().replace(/\/+$/, '');
  } catch(e) {
    pathname = urlLower;
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  const hasBrandSegment = pathSegments.some(seg => KNOWN_RV_BRANDS.includes(seg) || KNOWN_RV_BRANDS.includes(seg.replace(/-/g, ' ')));

  if (pathname.match(/\/(blog|news|article|articles)/)) return { category: 'blog', subCategory: 'article' };
  if (pathname.match(/\/(parts|rv-parts|parts-department|order-parts|accessories)/)) return { category: 'page', subCategory: 'parts-page' };
  if (pathname.match(/\/(service|rv-service|schedule-service|service-department)/)) return { category: 'page', subCategory: 'service-page' };
  if (pathname.match(/\/(specials|rv-specials|clearance|promotions|offers|sales-events)/)) return { category: 'page', subCategory: 'promotion-page' };
  if (pathname.match(/\/(testimonial|reviews|customer-feedback)/)) return { category: 'page', subCategory: 'testimonials' };
  if (pathname.match(/\/(events|calendar|rv-shows|shows)/)) return { category: 'page', subCategory: 'events' };

  const hasYear = YEAR_HEADER_REGEX.test(pathname);
  const hasID = /-\d{4,}(?:-\d+)?$/.test(pathname); 

  const isProductPath = pathname.includes('/product/') || pathname.includes('/rv/');
  
  if (isProductPath) {
      if (hasID || hasYear) {
          category = 'product';
          subCategory = urlLower.includes('pre-owned') || urlLower.includes('used') ? 'used-product' : 'new-product';
          return { category, subCategory };
      } else {
          return { category: 'collection', subCategory: 'category-node' };
      }
  }

  if (pathname.match(/\/(rv-search|inventory|new-rvs|used-rvs|rvs-for-sale|search-rvs|all-inventory)/)) {
    category = 'inventory';
    subCategory = urlLower.includes('used') || urlLower.includes('pre-owned') ? 'used-inventory' : 'new-inventory';
    return { category, subCategory };
  } 
  
  if (pathname.match(/\/(travel-trailers|fifth-wheels|motorhomes|toy-haulers|pop-up-campers|truck-campers)/)) {
    category = 'collection'; 
    subCategory = 'category-node';
    return { category, subCategory };
  }

  if (pathname.match(/\/(brands|manufacturers|rv-brands|showrooms|manufacturer-models)/) || hasBrandSegment) {
    category = 'collection'; 
    subCategory = 'brand-directory';
    return { category, subCategory };
  } 

  return { category, subCategory };
}

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

export function isCrawlablePath(urlStr, currentDepth = 0) {
  if (currentDepth >= 5) return false; 
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
// 4. INTERACT RV METADATA & PRICE EXTRACTION
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
  let year = '', brandName = '', modelName = '', vehicleType = 'RV';

  const specsRaw = $('.specs, .specifications, #specs, table.spec, .details-container, .vehicle-features, .srp-vehicle-details, .item-details, .unit-description').text().replace(/\s+/g, ' ').trim();
  if (specsRaw) specs = specsRaw.substring(0, 1500); 

  $('tr, li, dt, .price-row, .price-line, dl, .pricing-detail, div').each((_, el) => {
      const rowText = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
      
      if (rowText.length > 120 || rowText.includes('ranging from') || rowText.includes('starting at')) return;
      if (rowText.includes('rebate') || rowText.includes('fee') || rowText.includes('discount') || rowText.includes('savings') || rowText.includes('down payment')) return;

      const priceMatch = rowText.match(/\$\s*([1-9]\d{0,2}(?:,\d{3})*(?:\.\d{2})?)\b/);
      if (priceMatch) {
          const amt = `$${priceMatch[1]}`;
          if (rowText.includes('total price') || rowText.includes('final price')) salePrice = amt;
          else if (rowText.includes('retail price')) retailPrice = amt;
          else if (rowText.includes('selling price')) sellingPrice = amt;
          else if (rowText.includes('sale price') || rowText.includes('our price') || rowText.includes('internet price')) {
              if (!salePrice) salePrice = amt;
          }
          else if (rowText.includes('msrp')) msrp = amt;
          else if (rowText.includes('/mo') || rowText.includes('per month')) monthlyPayment = `${amt}/mo`;
      }
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if ((item['@type'] === 'Product' || item['@type'] === 'Vehicle' || item['@type'] === 'RV') && item.offers && item.offers.price) {
            if (parseFloat(item.offers.price) > 0 && !msrp) {
              msrp = `$${Number(item.offers.price).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            }
        }
      }
    } catch (e) {}
  });

  let metaDescription = $('meta[name="description"]').attr('content') || '';

  if (salePrice) {
      extractedPrice = salePrice;
      priceType = 'Sale / Our Price';
  } else if (sellingPrice) {
      extractedPrice = sellingPrice;
      priceType = 'Selling Price';
  } else if (retailPrice) {
      extractedPrice = retailPrice;
      priceType = 'Retail Price';
  } else if (msrp) {
      extractedPrice = msrp;
      priceType = 'MSRP';
  }

  if (!extractedPrice) {
      $('[class*="price" i], [id*="price" i]').each((_, el) => {
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

  return { price: extractedPrice, priceType, msrp: msrp || retailPrice, retailPrice: '', salePrice: salePrice || sellingPrice, sellingPrice: '', monthlyPayment, specs, year, brandName, modelName, vehicleType, metaDescription };
}

// ============================================================================
// 5. STRICT ENTITY, GBP URL, & ADDRESS EXTRACTION
// ============================================================================
export function extractDealershipProfile(htmlOrSelector, currentUrl) {
  const $ = typeof htmlOrSelector === 'function' ? htmlOrSelector : cheerio.load(htmlOrSelector);
  const rawHtmlString = typeof htmlOrSelector === 'string' ? htmlOrSelector : $.html();

  const profile = {
    dealershipName: '', legalCorporateName: '', dbaAlternateName: '', streetAddress: '',
    city: '', state: '', zipCode: '', telephoneMainLine: '', telephoneFax: '', 
    latitude: '', longitude: '', googleBusinessUrl: '', logoUrl: '', platform: 'Interact RV',
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
      const repairs = ['tune-up', 'winterization', 'oil change', 'tire installation', 'tire repair', 'diagnostics', 'engine rebuild', 'maintenance', 'inspection', 'battery', 'brake', 'roof', 'plumbing', 'electrical', 'awning'];
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

  $('header img, img.logo, img[id*="logo"], .site-logo img, .navbar-brand img').each((_, el) => {
    if (!profile.logoUrl) {
      const src = $(el).attr('src');
      if (src && !src.includes('data:image')) profile.logoUrl = new URL(src, currentUrl).toString();
    }
  });

  // 2. SCHEMA EXTRACTION
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
        }
      }
    } catch (e) {}
  });

  // DOM ADDRESS FALLBACK
  if (!profile.streetAddress) {
      let rawAddress = $('address').first().text().replace(/\s+/g, ' ').trim();
      if (!rawAddress) {
          const footerAddress = $('footer, .footer, .contact-info').text().match(/\d{1,5}\s+[A-Za-z0-9\s.,]+?(?:Street|St|Avenue|Ave|Road|Rd|Highway|Hwy|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Circle|Cir|Parkway|Pkwy)\b.*?(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}/i);
          if (footerAddress) rawAddress = footerAddress[0].replace(/\s+/g, ' ');
      }
      if (rawAddress) {
          const zipMatch = rawAddress.match(/\b\d{5}\b/);
          if (zipMatch) profile.zipCode = zipMatch[0];
          const stateMatch = rawAddress.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i);
          if (stateMatch) profile.state = stateMatch[0].toUpperCase();
          profile.streetAddress = rawAddress;
      }
  }

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
    const footerText = $('footer, .footer, #footer, .copyright, .footer-copyright, .site-footer').text().replace(/\s+/g, ' ');
    const cpMatch = footerText.match(/(?:©|Copyright|©)\s*(?:20\d{2}(?:\s*-\s*20\d{2})?)?\s+([^|.\-*•]+?)(?:\s+(?:All\s+Rights|Privacy|Terms|Website|Site\s+Map|Sitemap|$))/i);
    if (cpMatch && cpMatch[1]) {
      let name = cpMatch[1].replace(/all rights reserved/i, '').replace(/inc\/?/i, 'Inc.').replace(/llc\/?/i, 'LLC').trim();
      if (name.length > 2 && name.length < 80) profile.legalCorporateName = name;
    } 
    if (!profile.legalCorporateName || profile.legalCorporateName.length > 60) {
      const rawMatch = footerText.match(/©\s*(?:20\d{2})?\s*(.{5,50})/);
      if (rawMatch && rawMatch[1]) {
          let rawName = rawMatch[1].split(/[|•\-]/)[0];
          let cleanedName = rawName.replace(/all rights reserved/ig, '').replace(/powered by.*/ig, '').replace(/website by.*/ig, '').trim();
          if (cleanedName.length > 2 && cleanedName.length < 80) profile.legalCorporateName = cleanedName;
      }
    }
    if (!profile.legalCorporateName || profile.legalCorporateName.length > 60) {
      const title = $('title').text();
      if (title.includes('|')) profile.legalCorporateName = title.split('|').pop().trim();
      else if (title.includes('-')) profile.legalCorporateName = title.split('-').pop().trim();
    }
  }

  if (!profile.legalCorporateName && profile.dealershipName) {
     profile.legalCorporateName = `${profile.dealershipName} (Assumed)`;
  }

  // ============================================================================
  // 3. ADVANCED LINEAR HOURS PARSER
  // ============================================================================
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const getDayIndex = (str) => {
      const d = str.toLowerCase();
      if (d.startsWith('m')) return 0; if (d.startsWith('tu')) return 1; if (d.startsWith('w')) return 2;
      if (d.startsWith('th')) return 3; if (d.startsWith('f')) return 4; if (d.startsWith('sa')) return 5;
      if (d.startsWith('su')) return 6; return -1;
  };
  const customClosedRegex = /(gone riding|gone to church|out riding)/gi;

  let hoursContainers = $('.hours, .store-hours, footer, #footer, .contact-info, .business-hours, .location, [class*="hour" i], [id*="hour" i]');
  if (hoursContainers.length === 0) hoursContainers = $('body');

  hoursContainers.each((_, container) => {
      const cleanHtml = $(container).html()
          .replace(/<br[^>]*>/gi, '\n')
          .replace(/<\/div>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<\/li>/gi, '\n')
          .replace(/<\/tr>/gi, '\n')
          .replace(/<\/dt>/gi, '\n')
          .replace(/<\/dd>/gi, '\n')
          .replace(/<\/h[1-6]>/gi, '\n');
      
      const rawLines = cheerio.load(cleanHtml).text().split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let currentDept = 'storeHours';

      for (let i = 0; i < rawLines.length; i++) {
          let line = rawLines[i].toLowerCase();

          if (line.includes('service') || line.includes('parts') || line.includes('inspection')) {
              currentDept = 'serviceHours';
          } else if (line.includes('store') || line.includes('sales') || line.includes('showroom')) {
              currentDept = 'storeHours';
          }

          if (customClosedRegex.test(line)) line = line.replace(customClosedRegex, 'Closed');

          const dayOnlyRegex = /^(?:monday|mon|tuesday|tue|wednesday|wed|thursday|thu|thr|friday|fri|saturday|sat|sunday|sun)(?:\s*(?:-|to|thru|and|&)\s*(?:monday|mon|tuesday|tue|wednesday|wed|thursday|thu|thr|friday|fri|saturday|sat|sunday|sun))?[\s:-]*$/i;
          
          let combinedLine = line;
          if (dayOnlyRegex.test(line)) {
              if (i + 1 < rawLines.length) {
                  let nextLine = rawLines[i+1].toLowerCase();
                  if (customClosedRegex.test(nextLine)) nextLine = nextLine.replace(customClosedRegex, 'Closed');
                  
                  if (/(\d|closed)/.test(nextLine) && nextLine.length < 50) {
                      combinedLine = line + ' ' + nextLine;
                      i++; 
                  }
              }
          }

          if (combinedLine.length > 3 && combinedLine.length < 90 && /(\d|closed)/.test(combinedLine)) {
              const dayRegex = /\b(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|thr|friday|fri|saturday|sat|sunday|sun)\b/gi;
              let matches = [...combinedLine.matchAll(dayRegex)];
              
              if (matches.length > 0) {
                  let timeString = combinedLine.replace(dayRegex, '').replace(/^[&,\-:\s(to)(thru)(and)]+/i, '').trim();
                  timeString = timeString.replace(/^[^a-zA-Z0-9]+/, '').trim();
                  if (timeString.toLowerCase().includes('closed') || timeString === '') timeString = 'Closed';

                  let affectedDays = new Set();
                  const rangeMatch = combinedLine.match(/\b(mon|tue|wed|thu|thr|fri|sat|sun)[a-z]*\s*(?:-|to|thru)\s*(mon|tue|wed|thu|thr|fri|sat|sun)[a-z]*\b/i);
                  
                  if (rangeMatch) {
                      let startIdx = getDayIndex(rangeMatch[1]);
                      let endIdx = getDayIndex(rangeMatch[2]);
                      if (startIdx !== -1 && endIdx !== -1) {
                          if (startIdx <= endIdx) {
                              for (let j = startIdx; j <= endIdx; j++) affectedDays.add(dayNames[j]);
                          } else { 
                              for (let j = startIdx; j <= 6; j++) affectedDays.add(dayNames[j]);
                              for (let j = 0; j <= endIdx; j++) affectedDays.add(dayNames[j]);
                          }
                      }
                  } else {
                      matches.forEach(m => {
                          const idx = getDayIndex(m[0]);
                          if (idx !== -1) affectedDays.add(dayNames[idx]);
                      });
                  }

                  affectedDays.forEach(day => {
                      if (!profile[currentDept][day]) profile[currentDept][day] = timeString;
                  });
              }
          }
      }
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
    const targetLink = (href.toLowerCase() + ' ' + onclick.toLowerCase());

    if (!targetLink || targetLink.trim() === '' || targetLink.includes('javascript:void(0)')) return;
    if (href === '#' || href === '/' || href.startsWith('javascript:')) return;

    const buildUrl = (path) => { try { return new URL(path, currentUrl).toString(); } catch { return path; } };
    let absoluteLink = href.startsWith('/') ? buildUrl(href).toLowerCase() : href.toLowerCase();

    // 🚨 EXPANDED UNCONDITIONAL GOOGLE MAPS TRAP
    if (
      absoluteLink.includes('google.com/maps') || 
      absoluteLink.includes('maps.google.com') || 
      absoluteLink.includes('g.page')
    ) {
        if (!absoluteLink.includes('reviews')) {
            profile.googleBusinessUrl = href;
        }
    } else if (anchorText.includes('directions') || anchorText.includes('location')) {
        if (!profile.googleBusinessUrl && !absoluteLink.includes('javascript')) {
            profile.googleBusinessUrl = buildUrl(href);
        }
    }

    if (targetLink.includes('facebook.com/') && !profile.socialLinks.facebook) profile.socialLinks.facebook = href;
    if (targetLink.includes('instagram.com/') && !profile.socialLinks.instagram) profile.socialLinks.instagram = href;
    if (targetLink.includes('youtube.com/') && !profile.socialLinks.youtube) profile.socialLinks.youtube = href;
    if ((targetLink.includes('twitter.com/') || targetLink.includes('x.com/')) && !profile.socialLinks.twitter) profile.socialLinks.twitter = href;
    if (targetLink.includes('tiktok.com/') && !profile.socialLinks.tiktok) profile.socialLinks.tiktok = href;
    if (targetLink.includes('linkedin.com/') && !profile.socialLinks.linkedin) profile.socialLinks.linkedin = href;

    if (!profile.requiredUrls.parts && (absoluteLink.match(/\/(rv-parts|parts-department|parts|accessories)\b/) || anchorText.includes('parts department') || anchorText === 'parts') && !absoluteLink.includes('diagram') && !absoluteLink.includes('request')) profile.requiredUrls.parts = buildUrl(href);
    if (!profile.requiredUrls.service && (absoluteLink.match(/\/(rv-service|service-department|service|repair)\b/) || anchorText.includes('service department') || anchorText === 'service') && !absoluteLink.includes('schedule')) profile.requiredUrls.service = buildUrl(href);
    if (!profile.requiredUrls.finance && (absoluteLink.match(/\/(rv-financing|finance-application|finance|financing|credit|rv-loans?)\b/) || anchorText.includes('finance') || anchorText.includes('financing')) && !absoluteLink.includes('app')) profile.requiredUrls.finance = buildUrl(href);

    if (!profile.actionUrls.serviceScheduler && (absoluteLink.match(/\/(schedule-rv-service|schedule-service|service-appointment|appointment)\b/) || anchorText.includes('schedule service')) && !absoluteLink.includes('ride') && !absoluteLink.includes('drive')) profile.actionUrls.serviceScheduler = buildUrl(href);
    if (!profile.actionUrls.partsRequest && (absoluteLink.match(/\/(request-parts|parts-request|order-parts)\b/) || anchorText.includes('order parts') || anchorText.includes('request parts'))) profile.actionUrls.partsRequest = buildUrl(href);
    if (!profile.actionUrls.tradeIn && (absoluteLink.match(/\/(rv-trade-in|value-your-trade|value-your-rv|trade-in|trade)\b/) || anchorText.includes('value your trade') || anchorText.includes('trade in'))) profile.actionUrls.tradeIn = buildUrl(href);
    
    if (!profile.actionUrls.testimonials && (absoluteLink.match(/\/(testimonial|reviews|customer-feedback)\b/) || anchorText.includes('testimonials') || anchorText.includes('read reviews')) && !absoluteLink.includes('google')) profile.actionUrls.testimonials = buildUrl(href);
    if (!profile.actionUrls.testRide && (absoluteLink.match(/\/(schedule-tour|request-info|make-an-offer|contact-sales)\b/) || anchorText.includes('schedule a tour') || anchorText.includes('request info') || anchorText.includes('make an offer'))) profile.actionUrls.testRide = buildUrl(href);
    
    if (absoluteLink.includes('finance-app') || absoluteLink.includes('credit-application') || absoluteLink.includes('credit_app')) profile.actionUrls.financeApp = buildUrl(href);
    if (absoluteLink.includes('parts-diagram') || absoluteLink.includes('fiche') || absoluteLink.includes('oemparts')) profile.actionUrls.partsDiagrams = buildUrl(href);
    if (absoluteLink.includes('warranty') || absoluteLink.includes('recall')) profile.actionUrls.warrantyRecall = buildUrl(href);

    if ((absoluteLink.match(/\/(staff|team|about-us)\b/) || anchorText.includes('meet the team') || anchorText.includes('staff')) && !profile.actionUrls.staff) profile.actionUrls.staff = buildUrl(href);
    if ((absoluteLink.match(/\/(blog|news|articles)\b/)) && !profile.actionUrls.blog) profile.actionUrls.blog = buildUrl(href);
    if ((absoluteLink.match(/\/(events|calendar|shows|rv-shows)\b/) || anchorText.includes('events') || anchorText.includes('shows')) && !profile.actionUrls.events) profile.actionUrls.events = buildUrl(href);

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

  if (!profile.actionUrls.googleReviews) {
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || '';
      const lowerSrc = src.toLowerCase();
      if (
        lowerSrc.includes('elfsight.com') || 
        lowerSrc.includes('trustindex.io') || 
        lowerSrc.includes('embedsocial.com') || 
        lowerSrc.includes('reviews.io') || 
        lowerSrc.includes('socius') ||
        (lowerSrc.includes('review') && !lowerSrc.includes('youtube.com')) 
      ) {
        profile.actionUrls.googleReviews = `Review iFrame Detected: ${src}`;
      }
    });
  }

  if (!profile.actionUrls.googleReviews) {
    $('script').each((_, el) => {
      const src = $(el).attr('src')?.toLowerCase() || '';
      if (src.includes('elfsight.com') || src.includes('podium.com') || src.includes('birdeye.com') || src.includes('customerlobby.com') || src.includes('reputation.com')) {
         profile.actionUrls.googleReviews = `Widget Script Installed (${src})`;
      }
    });
  }

  $('iframe[src*="maps.google"], iframe[src*="google.com/maps"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !profile.googleBusinessUrl) {
      profile.googleBusinessUrl = src;
      const geoMatch = src.match(GOOGLE_MAPS_GEO_REGEX);
      if (geoMatch) { profile.longitude = geoMatch[1]; profile.latitude = geoMatch[2]; }
    }
  });

  // 🚨 UNIVERSAL GPS INFERENCER & RAW HTML FALLBACKS
  if (!profile.latitude || !profile.longitude) {
    const geoMeta = $('meta[name="geo.position"]').attr('content');
    if (geoMeta) {
        const parts = geoMeta.split(';');
        if (parts.length === 2) {
            profile.latitude = parts[0].trim();
            profile.longitude = parts[1].trim();
        }
    }
  }

  if (!profile.latitude || !profile.longitude) {
    const rawGeoMatch = rawHtmlString.match(/(?:lat|latitude)["'\s:=]+(-?\d{1,3}\.\d{3,})["',\s]+(?:lng|lon|longitude)["'\s:=]+(-?\d{1,3}\.\d{3,})/i);
    if (rawGeoMatch) {
      profile.latitude = rawGeoMatch[1];
      profile.longitude = rawGeoMatch[2];
    }
  }

  if (!profile.latitude || !profile.longitude) {
    if (profile.googleBusinessUrl) {
      const atMatch = profile.googleBusinessUrl.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
      if (atMatch) { 
          profile.latitude = atMatch[1]; 
          profile.longitude = atMatch[2]; 
      } else {
          const llMatch = profile.googleBusinessUrl.match(/(?:ll|q|query)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
          if (llMatch) { 
              profile.latitude = llMatch[1]; 
              profile.longitude = llMatch[2]; 
          } else {
              const pbMatch1 = profile.googleBusinessUrl.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
              if (pbMatch1) { profile.latitude = pbMatch1[1]; profile.longitude = pbMatch1[2]; }
              else {
                  const pbMatch2 = profile.googleBusinessUrl.match(/!2d(-?\d{1,3}\.\d+)!3d(-?\d{1,3}\.\d+)/);
                  if (pbMatch2) { profile.longitude = pbMatch2[1]; profile.latitude = pbMatch2[2]; }
              }
          }
      }
    }
  }

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
        
        const { category, subCategory } = categorizeLink(cleanUrl);
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
          vehicleType: autoDetails.vehicleType || 'RV', 
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