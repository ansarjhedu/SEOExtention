// services/crawler/platforms/dSpikeEngine.js

import * as cheerio from 'cheerio';
import { getCleanDomain, isAssetUrl, canonicalizeUrl } from '../utils.js';

// ============================================================================
// 1. DEALER SPIKE SPECIFIC URL CATEGORIZATION LOGIC
// ============================================================================
export function categorizeLink(urlStr) {
  const urlLower = urlStr.toLowerCase();
  let category = 'page';
  let subCategory = 'static';

  const pathSegments = new URL(urlStr).pathname.toLowerCase().split('/').filter(Boolean);
  const knownBrands = ['yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'seadoo', 'sea-doo', 'skidoo', 'ski-doo', 'harley-davidson', 'indian', 'triumph', 'ducati', 'bmw', 'vespa', 'husqvarna'];
  const hasBrandSegment = pathSegments.some(seg => knownBrands.includes(seg));

  // Dealer Spike uses specific query parameters for vehicles
  const isProduct = 
    urlLower.includes('xnewinventorydetail') || 
    urlLower.includes('xpreownedinventorydetail') || 
    urlLower.includes('xinventorydetail') ||
    (urlLower.includes('/inventory/v1/') && urlLower.split('/').length > 5) || 
    (urlLower.includes('-inventory-') && /\b(?:19|20)\d{2}\b/.test(urlLower));

  if (isProduct) {
    category = 'product';
    subCategory = urlLower.includes('pre-owned') || urlLower.includes('used') || urlLower.includes('xpreowned') ? 'used-product' : 'new-product';
  } 
  else if (urlLower.match(/\/(new-inventory|search-new|new-models|xnewinventory)/)) {
    category = 'inventory'; subCategory = 'new-inventory';
  } 
  else if (urlLower.match(/\/(pre-owned-inventory|search-pre-owned|used-inventory|xpreownedinventory)/)) {
    category = 'inventory'; subCategory = 'used-inventory';
  } 
  else if (urlLower.match(/\/(all-inventory|search-inventory|xallinventory)/)) {
    category = 'inventory'; subCategory = 'general-inventory';
  } 
  else if (urlLower.match(/\/(showcase|showcases|brand-directory|manufacturers?|xshowcase)/) || hasBrandSegment) {
    category = 'collection'; subCategory = 'brand-directory';
  } 
  else if (urlLower.match(/\/(service|service-department|schedule-service|xservice)/)) {
    category = 'page'; subCategory = 'service-page';
  } 
  else if (urlLower.match(/\/(parts|accessories|parts-department|order-parts|xparts)/)) {
    category = 'page'; subCategory = 'parts-page';
  } 
  else if (urlLower.match(/\/(promotions|factory-promotions|special-offers|sales-events|xpromotions)/)) {
    category = 'page'; subCategory = 'promotion-page';
  } 
  else if (urlLower.match(/\/(blog|news|articles|post|xblog)/)) {
    category = 'blog'; subCategory = 'article';
  }

  return { category, subCategory };
}

// ============================================================================
// 2. DEALER SPIKE SPECIFIC URL DETAIL EXTRACTION LOGIC
// ============================================================================
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

// ============================================================================
// 3. DEALER SPIKE CRAWLABLE PATH VALIDATION
// ============================================================================
export function isCrawlablePath(urlStr, currentDepth = 0) {
  if (currentDepth >= 4) return false;

  const lowerUrl = urlStr.toLowerCase();
  
  // Prevent Cloudflare Challenge redirect loops from clogging the queue
  if (lowerUrl.includes('__cf_chl_f_tk=')) return false; 

  const blacklistDirectories = [
    '/event', '/calendar', '/gallery', '/review', '/testimonial', 
    '/social', '/widget', '/forum', '/job', '/career', '/employment', 
    '/oemparts', '/fiche', '/microfiche', '/parts/search', '/partsfinder', 
    '/arinet', '/cart', '/checkout', '/account', '/shop/category',
    '/parts-diagrams', '/parts-finder', '/privacy', '/terms', 
    'print=true', 'send-to-friend', 'email_inventory', 'paymentcalculator'
  ];

  if (blacklistDirectories.some(dir => lowerUrl.includes(dir))) return false; 
  return true;
}

// ============================================================================
// 4. DEALER SPIKE METADATA & PRICE EXTRACTION
// ============================================================================
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
          if (item.offers && item.offers.price) {
            if (parseFloat(item.offers.price) > 0) {
                extractedPrice = `$${Number(item.offers.price).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            }
          }
        }
      }
    } catch (e) {}
  });

  $('script, style, noscript, iframe, svg').remove();

  if (!extractedPrice) {
    const priceSelectors = ['.price', '.VehiclePrice', '.sale-price', '.msrp', '[data-price]', '.our-price', '.internet-price'];
    for (const selector of priceSelectors) {
      const text = $(selector).first().text().replace(/\s+/g, ' ').trim();
      const priceMatch = text.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
      if (priceMatch) {
        extractedPrice = `$${priceMatch[1]}`;
        break;
      }
    }
  }

  let year = '', brandName = '', modelName = '', vehicleType = '';
  const vdpHeader = $('h1, .vdp-title, .VehicleTitle').first().text().replace(/\s+/g, ' ').trim();
  
  if (vdpHeader) {
    const yearMatch = vdpHeader.match(/\b(19[8-9]\d|20[0-2]\d)\b/);
    if (yearMatch) year = yearMatch[1];

    const knownBrands = ['yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'ryker', 'seadoo', 'sea-doo', 'skidoo', 'ski-doo', 'harley-davidson', 'indian', 'triumph', 'ducati', 'bmw'];
    const lowerHeader = vdpHeader.toLowerCase();
    for (const b of knownBrands) {
       if (lowerHeader.includes(` ${b} `) || lowerHeader.startsWith(`${b} `)) {
          brandName = b.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
          const brandIndex = lowerHeader.indexOf(b);
          let rawModel = vdpHeader.substring(brandIndex + b.length).trim();
          
          if (year) rawModel = rawModel.replace(new RegExp(`\\b${year}\\b`, 'i'), '').trim();
          rawModel = rawModel.replace(/new|used|for sale/ig, '').trim();
          if (rawModel) modelName = rawModel;
          break;
       }
    }
  }

  return { price: extractedPrice, year, brandName, modelName, vehicleType };
}

// ============================================================================
// 5. DEALER SPIKE ENTITY & NAP DATA EXTRACTION
// ============================================================================
export function extractDealershipProfile(html, currentUrl) {
  const $ = cheerio.load(html);
  const profile = {
    dealershipName: '', legalCorporateName: '', dbaAlternateName: '', streetAddress: '',
    city: '', state: '', zipCode: '', telephoneMainLine: '', telephoneFax: '', 
    latitude: '', longitude: '', googleBusinessUrl: '', logoUrl: '', platform: 'Dealer Spike',
    socialLinks: { facebook: '', instagram: '', youtube: '', twitter: '' },
    requiredUrls: { parts: '', service: '', finance: '' },
    actionUrls: { serviceScheduler: '', partsRequest: '', tradeIn: '', testRide: '', staff: '', blog: '', events: '', testimonials: '', googleReviews: '' },
    departmentPhones: { sales: '', service: '', parts: '' },
    storeHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' },
    serviceHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' }
  };

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
      if (name.length > 2 && name.length < 80) profile.legalCorporateName = name;
    } else {
      const rawMatch = footerText.match(/©\s*(?:20\d{2})?\s*(.{5,50})/);
      if (rawMatch && rawMatch[1]) profile.legalCorporateName = rawMatch[1].split('|')[0].replace(/all rights reserved/i, '').trim();
    }
  }

  const dayMap = { monday: ['monday', 'mon'], tuesday: ['tuesday', 'tue'], wednesday: ['wednesday', 'wed'], thursday: ['thursday', 'thu', 'thr'], friday: ['friday', 'fri'], saturday: ['saturday', 'sat'], sunday: ['sunday', 'sun'] };
  let activeHoursProfile = profile.storeHours; 

  $('.hours, .store-hours, footer, .footer').find('h2, h3, h4, strong, b, th, tr, li, p, div').each((_, el) => {
    const rawText = $(el).text().replace(/\s+/g, ' ').trim();
    const lowerText = rawText.toLowerCase();

    if ($(el).is('h2, h3, h4, h5, strong, b, th') || (lowerText.length > 3 && lowerText.length < 30)) {
      if (lowerText.includes('service') || lowerText.includes('parts')) activeHoursProfile = profile.serviceHours;
      else if (lowerText.includes('sales') || lowerText.includes('store') || lowerText.includes('showroom')) activeHoursProfile = profile.storeHours;
    }

    if (lowerText.length < 80) {
      Object.keys(dayMap).forEach(day => {
        if (!activeHoursProfile[day]) {
          const matched = dayMap[day].some(variant => lowerText.startsWith(variant) || lowerText.includes(variant));
          if (matched) {
            if (lowerText.includes('closed') || lowerText.includes('close')) activeHoursProfile[day] = 'Closed';
            else if (/(\d)/.test(lowerText)) activeHoursProfile[day] = rawText;
          }
        }
      });
    }
  });

  $('a, button').each((_, el) => {
    const href = $(el).attr('href') || '';
    const onclick = $(el).attr('onclick') || ''; 
    const anchorText = $(el).text().toLowerCase().trim();
    
    const safeHref = href.toLowerCase();
    const safeOnclick = onclick.toLowerCase();
    const targetLink = (safeHref + ' ' + safeOnclick);

    if (!targetLink || targetLink.trim() === '' || targetLink.includes('javascript:void(0)')) return;

    const buildUrl = (path) => { try { return new URL(path, currentUrl).toString(); } catch { return path; } };

    if (targetLink.includes('facebook.com/') && !profile.socialLinks.facebook) profile.socialLinks.facebook = href;
    if (targetLink.includes('instagram.com/') && !profile.socialLinks.instagram) profile.socialLinks.instagram = href;
    if (targetLink.includes('youtube.com/') && !profile.socialLinks.youtube) profile.socialLinks.youtube = href;
    if ((targetLink.includes('twitter.com/') || targetLink.includes('x.com/')) && !profile.socialLinks.twitter) profile.socialLinks.twitter = href;

    if ((targetLink.includes('parts') || targetLink.includes('xparts')) && !profile.requiredUrls.parts) profile.requiredUrls.parts = buildUrl(href);
    if ((targetLink.includes('service') || targetLink.includes('xservice')) && !profile.requiredUrls.service) profile.requiredUrls.service = buildUrl(href);
    if ((targetLink.includes('finance') || targetLink.includes('credit')) && !profile.requiredUrls.finance) profile.requiredUrls.finance = buildUrl(href);

    if ((targetLink.includes('schedule') || targetLink.includes('appointment')) && !profile.actionUrls.serviceScheduler) profile.actionUrls.serviceScheduler = buildUrl(href);
    if (targetLink.includes('parts-request') && !profile.actionUrls.partsRequest) profile.actionUrls.partsRequest = buildUrl(href);
    if ((targetLink.includes('value-your-trade') || targetLink.includes('trade-in')) && !profile.actionUrls.tradeIn) profile.actionUrls.tradeIn = buildUrl(href);
    if ((targetLink.includes('test-ride') || targetLink.includes('schedule-ride')) && !profile.actionUrls.testRide) profile.actionUrls.testRide = buildUrl(href);
    
    const isStaffLink = targetLink.includes('staff') || targetLink.includes('crew') || targetLink.includes('our-team') || targetLink.includes('meet-the-team') || anchorText.includes('meet the team') || anchorText.includes('our crew') || anchorText === 'staff' || anchorText === 'our team';
    if (isStaffLink && !profile.actionUrls.staff && !targetLink.includes('join-our-team')) profile.actionUrls.staff = buildUrl(href);

    if ((targetLink.includes('blog') || targetLink.includes('news') || targetLink.includes('articles')) && !profile.actionUrls.blog) profile.actionUrls.blog = buildUrl(href);
    
    if (
      safeHref.includes('search.google.com/local/writereview') || 
      safeHref.includes('business.google.com/reviews') || 
      safeHref.includes('g.page/r/') || 
      safeHref.includes('g.co/kgs/') || 
      (safeHref.includes('googleusercontent.com/maps') && anchorText.includes('review')) ||
      (safeHref.includes('google.com/search') && safeHref.includes('lrd='))
    ) {
      if (!profile.actionUrls.googleReviews) profile.actionUrls.googleReviews = href;
    }

    if (!profile.actionUrls.googleReviews && safeOnclick.includes('g.page/r/')) {
       const extractedUrl = onclick.match(/(?:window\.open|location\.href)\s*\(\s*['"](.*?)['"]/i);
       if (extractedUrl && extractedUrl[1]) profile.actionUrls.googleReviews = extractedUrl[1];
    }
  });

  return profile;
}

// ============================================================================
// 6. URL DEDUPLICATION AND LINK EXTRACTION
// ============================================================================
export function parseAndExtractLinks(html, currentUrl, targetUrl, targetDomain, session, currentDepth) {
  const $ = cheerio.load(html);
  const elements = $('a').toArray();

  for (const element of elements) {
    if (session.isTerminated) break;
    if (session.discoveredLinks.length >= 10000) { session.queue = []; break; }

    const href = $(element).attr('href');
    if (!href) continue;

    try {
      const absoluteUrl = new URL(href, currentUrl);
      const cleanUrl = canonicalizeUrl(absoluteUrl.toString());

      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) continue;
      if (isAssetUrl(cleanUrl)) continue;
      if (getCleanDomain(cleanUrl) !== targetDomain) continue;

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