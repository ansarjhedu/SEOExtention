// services/crawler/platforms/dSpikeEngine.js

import * as cheerio from 'cheerio';
import { getCleanDomain, isAssetUrl, canonicalizeUrl } from '../utils.js';

// ============================================================================
// 1. UNIVERSAL DEALER SPIKE CATEGORIZATION LOGIC
// ============================================================================
export function categorizeLink(urlStr) {
  const urlLower = urlStr.toLowerCase();
  let category = 'page';
  let subCategory = 'static';

  const pathname = new URL(urlStr).pathname.toLowerCase().replace(/\/+$/, '');
  const pathSegs = pathname.split('/').filter(Boolean);

  const knownBrands = ['yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'seadoo', 'sea-doo', 'skidoo', 'ski-doo', 'harley-davidson', 'indian', 'triumph', 'ducati', 'bmw', 'vespa', 'husqvarna', 'honda-power'];
  const hasBrandSegment = pathSegs.some(seg => knownBrands.includes(seg));

  const hasIdSuffix = /-\d{4,20}[a-z]?$/.test(pathname) || urlLower.includes('id='); 
  const isXDetail = pathname.includes('xnewinventorydetail') || pathname.includes('xpreownedinventorydetail') || pathname.includes('xinventorydetail');
  const hasYear = /\b(?:19|20)\d{2}\b/.test(pathname);

  const isWoodsProduct = (pathname.includes('/new-models/') || pathname.includes('/inventory/')) && hasYear && hasIdSuffix;
  const isDFWProduct = pathname.includes('/inventory/v1/') && pathSegs.length >= 5 && hasIdSuffix;
  const isStandardProduct = urlLower.includes('-inventory-') && hasIdSuffix;

  const isProduct = isXDetail || isWoodsProduct || isDFWProduct || isStandardProduct;

  const isPromo = pathname.includes('promo') || pathname.includes('special-offer') || pathname.includes('sales-event');
  const isParts = pathname.includes('part') || pathname.includes('accessories'); 
  const isWoodsCategoryNode = pathname.includes('/new-models/') && !hasYear && hasIdSuffix;

  if (pathname.includes('/search/inventory/') && pathSegs.length > 5) {
      category = 'collection'; subCategory = 'model-catalog-filters';
  }
  else if (isProduct) {
    category = 'product';
    subCategory = urlLower.includes('pre-owned') || urlLower.includes('used') || urlLower.includes('xpreowned') ? 'used-product' : 'new-product';
  } 
  else if (isPromo) {
    category = 'page'; subCategory = 'promotion-page';
  }
  else if (isParts) {
    category = 'page'; subCategory = 'parts-page';
  }
  else if (pathname.match(/\/(service|service-department|schedule-service|xservice)/)) {
    category = 'page'; subCategory = 'service-page';
  } 
  else if (pathname.match(/\/(blog|news|articles|post|xblog)/)) {
    category = 'blog'; subCategory = 'article';
  }
  else if (isWoodsCategoryNode) {
    category = 'collection'; subCategory = 'category-node';
  }
  else if (pathname.includes('/inventory/v1/current/')) {
    const currentIdx = pathSegs.indexOf('current');
    if (currentIdx !== -1) {
        const depthAfterCurrent = pathSegs.length - 1 - currentIdx;
        if (depthAfterCurrent === 1) { 
            category = 'collection'; subCategory = 'brand-directory';
        } else if (depthAfterCurrent === 2) { 
            category = 'collection'; subCategory = 'general-inventory';
        } else {
            category = 'inventory'; subCategory = 'general-inventory';
        }
    }
  }
  else if (pathname.match(/\/(new-inventory|search-new|xnewinventory)/)) {
    category = 'inventory'; subCategory = 'new-inventory';
  } 
  else if (pathname.match(/\/(pre-owned-inventory|search-pre-owned|used-inventory|xpreownedinventory)/)) {
    category = 'inventory'; subCategory = 'used-inventory';
  } 
  else if (pathname.match(/\/(all-inventory|search-inventory|xallinventory|inventory\/v1|\/search\/inventory)/)) {
    category = 'inventory'; subCategory = 'general-inventory';
  } 
  else if (pathname.match(/\/(showcase|showcases|brand-directory|manufacturers?|xshowcase|new-models)/) || hasBrandSegment) {
    category = 'collection'; subCategory = 'brand-directory';
  } 

  return { category, subCategory };
}

export function extractAutoDetails(urlStr) {
  const details = { year: '', brandName: '', modelName: '', vehicleType: 'Vehicle' };
  try {
    const urlObj = new URL(urlStr);
    const lowerUrl = urlObj.toString().toLowerCase();

    if (lowerUrl.includes('motorcycle')) details.vehicleType = 'Motorcycle';
    else if (lowerUrl.includes('atv') || lowerUrl.includes('quad')) details.vehicleType = 'ATV';
    else if (lowerUrl.includes('utility-vehicle') || lowerUrl.includes('utv') || lowerUrl.includes('side-by-side')) details.vehicleType = 'UTV';
    else if (lowerUrl.includes('personal-watercraft') || lowerUrl.includes('pwc') || lowerUrl.includes('waverunner')) details.vehicleType = 'PWC';
    else if (lowerUrl.includes('scooter')) details.vehicleType = 'Scooter';
    else if (lowerUrl.includes('snowmobile')) details.vehicleType = 'Snowmobile';
    else if (lowerUrl.includes('boat') || lowerUrl.includes('pontoon')) details.vehicleType = 'Boat';
    else if (lowerUrl.includes('generator')) details.vehicleType = 'Generator';
    else if (lowerUrl.includes('mower')) details.vehicleType = 'Lawn Mower';
    else if (lowerUrl.includes('bicycle')) details.vehicleType = 'E-Bike';

    const yearMatch = lowerUrl.match(/\b((?:19|20)\d{2})\b/);
    if (yearMatch) details.year = yearMatch[1];

    const knownBrands = ['yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'ryker', 'seadoo', 'sea-doo', 'skidoo', 'ski-doo', 'harley-davidson', 'indian', 'triumph', 'ducati', 'bmw', 'kymco', 'hisun', 'segway', 'royal-enfield', 'tracker', 'vespa', 'husqvarna', 'gasgas', 'beta'];
    for (const b of knownBrands) {
      if (lowerUrl.includes(b)) {
        details.brandName = b.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        break;
      }
    }
  } catch (e) {}
  return details;
}

export function isCrawlablePath(urlStr, currentDepth = 0) {
  if (currentDepth >= 4) return false;
  const lowerUrl = urlStr.toLowerCase();
  
  if (lowerUrl.includes('__cf_chl_f_tk=') || lowerUrl.includes('/sort/') || lowerUrl.includes('page=')) return false; 
  const segments = lowerUrl.split('/');
  if (lowerUrl.includes('/search/') && segments.length > 6) return false;

  const blacklistDirectories = [
    '/event', '/calendar', '/gallery', '/review', '/testimonial', 
    '/social', '/widget', '/forum', '/job', '/career', '/employment', 
    '/oemparts', '/fiche', '/microfiche', '/parts/search', '/partsfinder', 
    '/arinet', '/cart', '/checkout', '/account', '/shop/category', '/ecommerce',
    '/parts-diagrams', '/parts-finder', '/privacy', '/terms', 
    'print=true', 'send-to-friend', 'email_inventory', 'paymentcalculator'
  ];

  return !blacklistDirectories.some(dir => lowerUrl.includes(dir));
}

// ============================================================================
// 4. DEEP VDP EXTRACTION (Prices, Naked Tags & Specifications)
// ============================================================================
export function extractPageMetadata(html) {
  const $ = cheerio.load(html);
  let extractedPrice = '';
  let priceType = '';
  let msrp = '';
  let retailPrice = '';
  let salePrice = '';
  let sellingPrice = '';
  let monthlyPayment = '';
  let specs = '';
  let year = '', brandName = '', modelName = '', vehicleType = '';

  const specsRaw = $('.specs, .specifications, #specs, table.spec, .details-container, .vehicle-features, .srp-vehicle-details, .item-details, .unit-description').text().replace(/\s+/g, ' ').trim();
  if (specsRaw) specs = specsRaw.substring(0, 1500); 

  // SURGICAL DOM LABEL MATCHER
  $('span, div, dt').each((_, el) => {
      const labelText = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
      let priceVal = '';

      const inlineMatch = labelText.match(/(retail price|msrp|sale price|selling price|our price|total price)\s*[-:]?\s*\$?\s*([1-9]\d{0,2}(?:,\d{3})*(?:\.\d{2})?)/i);
      if (inlineMatch) {
          priceVal = `$${inlineMatch[2]}`;
      } else {
          const siblingText = $(el).next().text().trim() || $(el).parent().find('span.showroom-detail__price-value, .spec').text().trim();
          const siblingMatch = siblingText.match(/\$\s*([1-9]\d{0,2}(?:,\d{3})*(?:\.\d{2})?)/);
          if (siblingMatch) priceVal = `$${siblingMatch[1]}`;
      }

      if (priceVal) {
          if (labelText.includes('retail price')) retailPrice = priceVal;
          else if (labelText.includes('selling price')) sellingPrice = priceVal;
          else if (labelText.includes('sale price') || labelText.includes('our price') || labelText.includes('total price')) salePrice = priceVal;
          else if (labelText.includes('msrp')) msrp = priceVal;
      }
  });

  $('script').each((_, el) => {
    const scriptContent = $(el).html() || '';
    if (scriptContent.includes('__PRELOADED_STATE__') || scriptContent.includes('__NEXT_DATA__') || scriptContent.includes('window.m_item')) {
        try {
            const statePriceMatch = scriptContent.match(/(?:sellingPrice|retailPrice|price_value)["']?\s*:\s*["']?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
            if (statePriceMatch && parseFloat(statePriceMatch[1].replace(/,/g, '')) > 0 && !sellingPrice) {
                sellingPrice = `$${statePriceMatch[1]}`;
            }
            const paymentMatch = scriptContent.match(/(?:monthlyPayment|paymentAmount)["']?\s*:\s*["']?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
            if (paymentMatch && !monthlyPayment && parseFloat(paymentMatch[1].replace(/,/g, '')) > 0) monthlyPayment = `$${paymentMatch[1]}/mo`;
        } catch (e) {}
    }
  });

  let metaDescription = $('meta[name="description"]').attr('content') || '';

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'Vehicle' || item['@type'] === 'Motorcycle') {
          if (item.offers && item.offers.price && parseFloat(item.offers.price) > 0 && !msrp) {
              msrp = `$${Number(item.offers.price).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
          }
          if (item.brand && item.brand.name) brandName = item.brand.name;
          if (item.name) {
              const nameMatch = item.name.match(/\b(19[8-9]\d|20[0-2]\d)\b/);
              if (nameMatch) year = nameMatch[1];
              let rawModel = item.name;
              if (year) rawModel = rawModel.replace(new RegExp(`\\b${year}\\b`, 'i'), '');
              if (brandName) rawModel = rawModel.replace(new RegExp(`\\b${brandName}\\b`, 'i'), '');
              rawModel = rawModel.trim();
              if (rawModel) modelName = rawModel;
          }
        }
      }
    } catch (e) {}
  });

  $('script, style, noscript, iframe, svg').remove();

  if (!monthlyPayment) {
      const bodyText = $('body').text().replace(/\s+/g, ' ');
      const moMatch = bodyText.match(/\$\s*([0-9]{2,4}(?:\.[0-9]{2})?)\s*(?:\/mo|per month|a month)/i);
      if (moMatch) monthlyPayment = `$${moMatch[1]}/mo`;
  }

  // DETERMINE PRIMARY PRICE TAG HIERARCHY
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

  // BLIND FALLBACK FOR NAKED DOLLARS
  if (!extractedPrice) {
      $('[class*="price" i], [id*="price" i], .showroom-detail__price-value, .spec').each((_, el) => {
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

  return { 
      price: extractedPrice, 
      priceType, 
      msrp: msrp || retailPrice, 
      retailPrice: '', 
      salePrice: salePrice || sellingPrice, 
      sellingPrice: '', 
      monthlyPayment, specs, year, brandName, modelName, vehicleType, metaDescription 
  };
}

// ============================================================================
// 5. PARALLEL DEEP TEXT & INTELLIGENT HOURS EXTRACTOR
// ============================================================================
export function extractDealershipProfile(html, currentUrl) {
  const $ = cheerio.load(html);
  
  const profile = {
    dealershipName: '', legalCorporateName: '', dbaAlternateName: '', streetAddress: '',
    city: '', state: '', zipCode: '', telephoneMainLine: '', telephoneFax: '', 
    latitude: '', longitude: '', googleBusinessUrl: '', logoUrl: '', platform: 'Dealer Spike',
    socialLinks: { facebook: '', instagram: '', youtube: '', twitter: '', tiktok: '', linkedin: '' },
    requiredUrls: { parts: '', service: '', finance: '', bodyShop: '', careers: '' }, 
    actionUrls: { serviceScheduler: '', partsRequest: '', tradeIn: '', testRide: '', staff: '', blog: '', events: '', testimonials: '', googleReviews: '', financeApp: '', partsDiagrams: '', warrantyRecall: '' },
    departmentPhones: { sales: '', service: '', parts: '' },
    storeHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' },
    serviceHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' }, 
    financeDetails: { lendingPartners: [], programsOffered: [], financingLanguage: '' },
    serviceDetails: { tiers: [], claims: [], brandsServiced: [], nonFranchiseAccepted: '', unitAgeLimitations: '' },
    partsDetails: { oemSupport: '', aftermarketSupport: '', specialOrders: '' },
    bodyShopDetails: { servicesOffered: [], paintServices: '' }
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
      if (pageText.includes('service all makes') || pageText.includes('work on all brands') || pageText.includes('any brand')) profile.serviceDetails.nonFranchiseAccepted = currentUrl;
      const ageMatch = pageText.match(/.{0,30}\b(?:years or older|newer than|older than 10)\b.{0,30}/i);
      if (ageMatch) profile.serviceDetails.unitAgeLimitations = ageMatch[0].trim();
  }
  if (currentUrlLower.includes('part') || currentUrlLower.includes('accessories')) {
      if (pageText.includes('oem') || pageText.includes('original equipment')) profile.partsDetails.oemSupport = currentUrl;
      if (pageText.includes('aftermarket') || pageText.includes('accessories')) profile.partsDetails.aftermarketSupport = currentUrl;
      if (pageText.includes('special order') || pageText.includes('hard to find')) profile.partsDetails.specialOrders = currentUrl;
  }
  if (currentUrlLower.includes('body') || currentUrlLower.includes('collision')) {
      if (pageText.includes('paint') || pageText.includes('color match')) profile.bodyShopDetails.paintServices = currentUrl;
      if (pageText.includes('collision') || pageText.includes('dent')) profile.bodyShopDetails.servicesOffered.push('Collision Repair');
  }

  // 2. ENTITY & LOGO EXTRACTION
  $('header img, img.logo, .navbar-brand img, .site-logo img').each((_, el) => {
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
          if (item.name && !profile.dealershipName) profile.dealershipName = item.name;
          if (item.legalName && !profile.legalCorporateName) profile.legalCorporateName = item.legalName;
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

  if (!profile.legalCorporateName) {
    const footerText = $('footer, .footer, #footer, .copyright, .footer-copyright').text().replace(/\s+/g, ' ');
    const cpMatch = footerText.match(/(?:©|Copyright|©)\s*(?:20\d{2}(?:\s*-\s*20\d{2})?)?\s+([^|.\-*•]+?)(?:\s+(?:All\s+Rights|Privacy|Terms|Website|Site\s+Map|Sitemap|$))/i);
    if (cpMatch && cpMatch[1]) {
      let name = cpMatch[1].replace(/all rights reserved/i, '').replace(/inc\/?/i, 'Inc.').replace(/llc\/?/i, 'LLC').trim();
      if (name.length > 2 && name.length < 60 && !name.includes('http')) profile.legalCorporateName = name;
    } 
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

  let hoursContainers = $('.hours, .store-hours, .contact-info, .business-hours, .location, [class*="hour" i], [id*="hour" i]');
  if (hoursContainers.length === 0) hoursContainers = $('footer, #footer');
  if (hoursContainers.length === 0) hoursContainers = $('body');

  let topLevelContainers = [];
  hoursContainers.each((_, el) => {
      let hasHoursParent = false;
      $(el).parents().each((_, p) => {
          if ($(p).is('.hours, .store-hours, .contact-info, .business-hours, .location, [class*="hour" i], [id*="hour" i]')) {
              hasHoursParent = true;
          }
      });
      if (!hasHoursParent) topLevelContainers.push(el);
  });

  $(topLevelContainers).each((_, container) => {
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
      
      let containerClass = $(container).attr('class') || '';
      let baseContext = containerClass.toLowerCase();
      let currentDept = 'storeHours';
      if (baseContext.includes('service') || baseContext.includes('parts')) currentDept = 'serviceHours';

      for (let i = 0; i < rawLines.length; i++) {
          let line = rawLines[i].toLowerCase();

          if (line === 'service hours' || line.includes('service dept') || line.includes('parts') || line.includes('inspection')) {
              currentDept = 'serviceHours';
          } else if (line === 'store hours' || line === 'sales hours' || line === 'showroom') {
              currentDept = 'storeHours';
          }

          if (customClosedRegex.test(line)) line = line.replace(customClosedRegex, 'closed');

          const dayOnlyRegex = /^(?:monday|mon|tuesday|tue|wednesday|wed|thursday|thu|thr|friday|fri|saturday|sat|sunday|sun)(?:\s*(?:-|to|thru|and|&)\s*(?:monday|mon|tuesday|tue|wednesday|wed|thursday|thu|thr|friday|fri|saturday|sat|sunday|sun))?[\s:-]*$/i;
          
          let combinedLine = line;
          if (dayOnlyRegex.test(line)) {
              if (i + 1 < rawLines.length) {
                  let nextLine = rawLines[i+1].toLowerCase();
                  if (customClosedRegex.test(nextLine)) nextLine = nextLine.replace(customClosedRegex, 'closed');
                  
                  if (/(\d|closed)/i.test(nextLine) && nextLine.length < 50) {
                      combinedLine = line + ' ' + nextLine;
                      i++; 
                      
                      if (i + 1 < rawLines.length) {
                          let l2 = rawLines[i+1].toLowerCase();
                          if (l2 === '-' || l2 === 'to' || l2 === 'thru' || /(\d|am|pm)/i.test(l2)) {
                              combinedLine += ' ' + l2;
                              i++;
                              if (i + 1 < rawLines.length && (l2 === '-' || l2 === 'to' || l2 === 'thru')) {
                                  let l3 = rawLines[i+1].toLowerCase();
                                  if (/(\d|am|pm)/i.test(l3)) {
                                      combinedLine += ' ' + l3;
                                      i++;
                                  }
                              }
                          }
                      }
                  }
              }
          }

          if (combinedLine.length > 3 && combinedLine.length < 90 && /(\d|closed)/i.test(combinedLine)) {
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

  const allPhones = [...new Set(html.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [])];
  if (allPhones.length > 0 && !profile.telephoneMainLine) profile.telephoneMainLine = allPhones[0];

  $('a[href^="tel:"], p, div, span, tr, td').each((_, el) => {
    const text = $(el).text().trim();
    const phoneMatches = [...text.matchAll(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g)].map(m => m[0]);
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

  // 4. ACTION URLS & ANCHORS
  $('a, button').each((_, el) => {
    const href = $(el).attr('href') || '';
    const onclick = $(el).attr('onclick') || ''; 
    const anchorText = $(el).text().toLowerCase().trim();
    const targetLink = (href.toLowerCase() + ' ' + onclick.toLowerCase());

    if (!targetLink || targetLink.trim() === '' || targetLink.includes('javascript:void(0)')) return;

    const buildUrl = (path) => { try { return new URL(path, currentUrl).toString(); } catch { return path; } };
    let absoluteLink = href.startsWith('/') || href.startsWith('.') ? buildUrl(href).toLowerCase() : href.toLowerCase();

    // Social Links
    if (targetLink.includes('facebook.com/') && !profile.socialLinks.facebook) profile.socialLinks.facebook = href;
    if (targetLink.includes('instagram.com/') && !profile.socialLinks.instagram) profile.socialLinks.instagram = href;
    if (targetLink.includes('youtube.com/') && !profile.socialLinks.youtube) profile.socialLinks.youtube = href;
    if ((targetLink.includes('twitter.com/') || targetLink.includes('x.com/')) && !profile.socialLinks.twitter) profile.socialLinks.twitter = href;
    if (targetLink.includes('tiktok.com/') && !profile.socialLinks.tiktok) profile.socialLinks.tiktok = href;
    if (targetLink.includes('linkedin.com/') && !profile.socialLinks.linkedin) profile.socialLinks.linkedin = href;

    // Required Directories
    if ((absoluteLink.includes('part') || absoluteLink.includes('xparts')) && !profile.requiredUrls.parts && !absoluteLink.includes('diagram') && !absoluteLink.includes('request')) profile.requiredUrls.parts = buildUrl(href);
    if ((absoluteLink.includes('service') || absoluteLink.includes('xservice')) && !profile.requiredUrls.service && !absoluteLink.includes('schedule')) profile.requiredUrls.service = buildUrl(href);
    if ((absoluteLink.includes('finance') || absoluteLink.includes('credit')) && !profile.requiredUrls.finance && !absoluteLink.includes('app')) profile.requiredUrls.finance = buildUrl(href);
    if ((absoluteLink.includes('body-shop') || absoluteLink.includes('collision')) && !profile.requiredUrls.bodyShop) profile.requiredUrls.bodyShop = buildUrl(href);
    if ((absoluteLink.includes('career') || absoluteLink.includes('employment')) && !profile.requiredUrls.careers) profile.requiredUrls.careers = buildUrl(href);

    // Deep Actions
    if ((absoluteLink.includes('schedule') || absoluteLink.includes('appointment')) && !absoluteLink.includes('ride') && !absoluteLink.includes('drive') && !profile.actionUrls.serviceScheduler) {
         profile.actionUrls.serviceScheduler = buildUrl(href);
    }
    if (absoluteLink.includes('parts-request') && !profile.actionUrls.partsRequest) profile.actionUrls.partsRequest = buildUrl(href);
    if ((absoluteLink.includes('value-your-trade') || absoluteLink.includes('trade-in')) && !profile.actionUrls.tradeIn) profile.actionUrls.tradeIn = buildUrl(href);
    if ((absoluteLink.includes('test-ride') || absoluteLink.includes('schedule-ride')) && !profile.actionUrls.testRide) profile.actionUrls.testRide = buildUrl(href);
    if (absoluteLink.includes('finance-app') || absoluteLink.includes('credit-application') || absoluteLink.includes('credit_app')) profile.actionUrls.financeApp = buildUrl(href);
    if (absoluteLink.includes('parts-diagram') || absoluteLink.includes('fiche') || absoluteLink.includes('oemparts')) profile.actionUrls.partsDiagrams = buildUrl(href);
    if (absoluteLink.includes('warranty') || absoluteLink.includes('recall')) profile.actionUrls.warrantyRecall = buildUrl(href);

    const isStaffLink = absoluteLink.includes('staff') || absoluteLink.includes('crew') || absoluteLink.includes('our-team') || absoluteLink.includes('meet-the-team') || anchorText.includes('meet the team');
    if (isStaffLink && !profile.actionUrls.staff && !absoluteLink.includes('join-our-team')) profile.actionUrls.staff = buildUrl(href);

    if ((absoluteLink.includes('blog') || absoluteLink.includes('news') || absoluteLink.includes('articles')) && !profile.actionUrls.blog) profile.actionUrls.blog = buildUrl(href);
    if ((absoluteLink.includes('testimonial') || absoluteLink.includes('review')) && !profile.actionUrls.testimonials) profile.actionUrls.testimonials = buildUrl(href);

    // 🚨 EXPANDED STRICT URL-ONLY GOOGLE REVIEW MATCHER
    if (
      absoluteLink.includes('search.google.com/local/writereview') || 
      absoluteLink.includes('business.google.com/reviews') || 
      absoluteLink.includes('g.page/r/') || 
      absoluteLink.match(/googleusercontent\.com\/maps\.google\.com\/\d+/) || 
      (absoluteLink.includes('google.com/search') && absoluteLink.includes('lrd=')) ||
      (absoluteLink.includes('googleusercontent.com/maps') && anchorText.includes('review'))
    ) {
      if (!profile.actionUrls.googleReviews) profile.actionUrls.googleReviews = href;
    }
  });

  // Google Maps Coordinates Trap
  $('iframe[src*="maps.google"], iframe[src*="google.com/maps"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !profile.googleBusinessUrl) {
      profile.googleBusinessUrl = src;
      const geoMatch = src.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
      if (geoMatch) { profile.longitude = geoMatch[1]; profile.latitude = geoMatch[2]; }
    }
  });

  return profile;
}

// ============================================================================
// 6. SITE CRAWL ENGINE IMPLEMENTATION LAYER
// ============================================================================
export function parseAndExtractLinks(html, currentUrl, targetUrl, targetDomain, session, currentDepth) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove(); 

  $('a').each((_, element) => {
    if (session.isTerminated) return;
    if (session.discoveredLinks.length >= 10000) { session.queue = []; return; }

    const href = $(element).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, currentUrl);
      const cleanUrl = canonicalizeUrl(absoluteUrl.toString());

      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) return;
      if (isAssetUrl(cleanUrl)) return;
      if (getCleanDomain(cleanUrl) !== targetDomain) return;

      let anchorText = $(element).text().trim();
      if (!anchorText) {
        const innerImg = $(element).find('img');
        anchorText = innerImg.length ? $(innerImg).attr('alt')?.trim() || '[Image Link]' : '[No Text]';
      }

      const dedupeKey = cleanUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();

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
  });
}