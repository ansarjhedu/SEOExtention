// services/crawler/platforms/dxEngine.js

import * as cheerio from 'cheerio';
import { 
  getCleanDomain, 
  isAssetUrl, 
  canonicalizeUrl 
} from '../utils.js';

// ============================================================================
// 1. DX1 SPECIFIC URL CATEGORIZATION LOGIC
// ============================================================================
export function categorizeLink(urlStr) {
  const urlLower = urlStr.toLowerCase();
  let category = 'page';
  let subCategory = 'static';

  const isProduct = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(urlLower);
  
  const pathSegments = new URL(urlStr).pathname.toLowerCase().split('/').filter(Boolean);
  const knownBrands = ['yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'seadoo', 'sea-doo', 'skidoo', 'ski-doo', 'harley-davidson', 'indian', 'triumph', 'ducati', 'bmw', 'vespa', 'husqvarna'];
  const hasBrandSegment = pathSegments.some(seg => knownBrands.includes(seg));
  const hasBlogSegment = pathSegments.some(seg => ['blog', 'news', 'article', 'articles'].includes(seg));

  if (isProduct) {
    category = 'product';
    subCategory = urlLower.includes('pre-owned') || urlLower.includes('used') ? 'used-product' : 'new-product';
  } else if (urlLower.match(/\/(search-inventory\/new|new-inventory|new-vehicles|new-models|new-powersports|search\/new)/)) {
    category = 'inventory'; subCategory = 'new-inventory';
  } else if (urlLower.match(/\/(search-inventory\/pre-owned|used-inventory|used-vehicles|pre-owned-models|pre-owned-powersports|search\/pre-owned|search\/used)/)) {
    category = 'inventory'; subCategory = 'used-inventory';
  } else if (urlLower.match(/\/(search-inventory|inventory|all-inventory|vehicles|search)/) && !urlLower.includes('search.google')) {
    category = 'inventory'; subCategory = 'general-inventory';
  } else if (urlLower.match(/\/(brands?|showrooms?|manufacturer-models|oem-models|catalogs?|manufacturers?|model-list)/) || hasBrandSegment) {
    category = 'collection'; subCategory = 'brand-directory';
  } else if (urlLower.match(/\/(service|service-department|schedule-service)/)) {
    category = 'page'; subCategory = 'service-page';
  } else if (urlLower.match(/\/(parts|accessories|parts-department|order-parts)/)) {
    category = 'page'; subCategory = 'parts-page';
  } else if (urlLower.match(/\/(promotions?|promo|special-offers|specials|current-offers|factory-promotions|sales-events|in-stock-deals|offers)/)) {
    category = 'page'; subCategory = 'promotion-page';
  } else if (hasBlogSegment) {
    category = 'blog'; subCategory = 'article';
  }

  return { category, subCategory };
}

// ============================================================================
// 2. DX1 SPECIFIC URL DETAIL EXTRACTION LOGIC
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
    else if (lowerSlug.includes('trailer')) details.vehicleType = 'Trailer';

    const yearMatch = slug.match(/-((?:19|20)\d{2})-/);
    if (yearMatch) details.year = yearMatch[1];

    const knownBrands = [
      'yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'ryker', 
      'seadoo', 'sea-doo', 'skidoo', 'ski-doo', 'harley-davidson', 'indian', 'triumph', 'ducati', 'bmw', 
      'kymco', 'hisun', 'segway', 'royal-enfield', 'tracker', 'nitro', 'tahoe', 'mako', 'sun-tracker', 
      'regency', 'vespa', 'piaggio', 'aprilia', 'moto-guzzi', 'husqvarna', 'gasgas', 'beta', 'sherco', 
      'slingshot', 'timbersled', 'stark', 'kayo', 'ssr', 'benelli', 'mv-agusta', 'zero'
    ];
    
    let foundBrand = '';
    for (const b of knownBrands) {
      if (lowerSlug.includes(`-${b}-`) || lowerSlug.startsWith(`${b}-`)) {
        foundBrand = b;
        details.brandName = b.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        break;
      }
    }

    if (foundBrand && details.year) {
       const brandIndex = lowerSlug.indexOf(foundBrand);
       const yearIndex = lowerSlug.indexOf(`-${details.year}-`);
       if (brandIndex !== -1 && yearIndex !== -1 && yearIndex > brandIndex) {
          const modelSlug = slug.substring(brandIndex + foundBrand.length + 1, yearIndex);
          if (modelSlug) {
            details.modelName = modelSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }
       }
    }
  } catch (e) {}
  return details;
}

// ============================================================================
// 3. DX1 CRAWLABLE PATH VALIDATION
// ============================================================================
export function isCrawlablePath(urlStr, currentDepth = 0) {
  if (currentDepth >= 4) return false;

  const lowerUrl = urlStr.toLowerCase();
  
  const blacklistDirectories = [
    '/event', '/calendar', '/gallery', '/review', '/testimonial', 
    '/social', '/widget', '/forum', '/job', '/career', '/employment', 
    '/oemparts', '/fiche', '/microfiche', '/parts/search', '/partsfinder', 
    '/arinet', '/cart', '/checkout', '/account', '/shop/category',
    '/parts-diagrams', '/parts-finder', '/privacy', '/terms'
  ];

  if (blacklistDirectories.some(dir => lowerUrl.includes(dir))) return false; 

  const whitelistDirectories = [
    '/brands', '/manufacturer-models', '/model-list', '/showrooms', '/catalogs',
    '/inventory', '/search', 'searchinventory', '-vehicles', '/pre-owned',
    '/promotions', '/oem-promotions', '/promotion', '/promo', '/specials', '/offers',
    '/parts', '/accessories', '/parts-department', '/order-parts',
    '/finance', '/credit', '/service', '/about', '/contact', '/faq',
    '/blog', '/news', '/articles'
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
    const priceSelectors = ['.price', '[class*="price-value"]', '.sale-price', '.msrp', '.regular-price', '[data-price]', '.veh-price'];
    for (const selector of priceSelectors) {
      const text = $(selector).first().text().replace(/\s+/g, ' ').trim();
      const priceMatch = text.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
      if (priceMatch) {
        extractedPrice = `$${priceMatch[1]}`;
        break;
      }
    }
  }

  if (!extractedPrice) {
    const bodyText = $('body').text();
    const match = bodyText.match(/(?:price|msrp|our price|sale price)\s*:?\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
    if (match && parseFloat(match[1].replace(/,/g, '')) > 0) {
      extractedPrice = `$${match[1]}`;
    }
  }

  let year = '', brandName = '', modelName = '', vehicleType = '';
  const vdpHeader = $('h1, .vdp-title, [class*="vehicle-title"]').first().text().replace(/\s+/g, ' ').trim();
  
  if (vdpHeader) {
    const yearMatch = vdpHeader.match(/\b(19[8-9]\d|20[0-2]\d)\b/);
    if (yearMatch) year = yearMatch[1];

    const knownBrands = [
      'yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am', 'spyder', 'ryker', 
      'seadoo', 'sea-doo', 'skidoo', 'ski-doo', 'harley-davidson', 'indian', 'triumph', 'ducati', 'bmw', 
      'kymco', 'hisun', 'segway', 'royal enfield', 'tracker', 'nitro', 'tahoe', 'mako', 'sun tracker', 
      'regency', 'vespa', 'piaggio', 'aprilia', 'moto guzzi', 'husqvarna', 'gasgas', 'beta', 'sherco'
    ];
    
    const lowerHeader = vdpHeader.toLowerCase();
    
    for (const b of knownBrands) {
       if (lowerHeader.includes(` ${b} `) || lowerHeader.startsWith(`${b} `)) {
          brandName = b.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
          
          const brandIndex = lowerHeader.indexOf(b);
          let rawModel = vdpHeader.substring(brandIndex + b.length).trim();
          
          if (year) {
              const yearRegex = new RegExp(`\\b${year}\\b`, 'i');
              rawModel = rawModel.replace(yearRegex, '').trim();
          }
          rawModel = rawModel.replace(/new|used|for sale/ig, '').trim();
          if (rawModel) modelName = rawModel;
          break;
       }
    }
  }

  return { price: extractedPrice, year, brandName, modelName, vehicleType };
}

// ============================================================================
// 4. DX1 ENTITY & NAP DATA EXTRACTION
// ============================================================================
export function extractDealershipProfile(html, currentUrl) {
  const $ = cheerio.load(html);
  const profile = {
    dealershipName: '', legalCorporateName: '', dbaAlternateName: '', streetAddress: '',
    city: '', state: '', zipCode: '', telephoneMainLine: '', telephoneFax: '', 
    latitude: '', longitude: '', googleBusinessUrl: '', logoUrl: '', platform: 'DX1',
    socialLinks: { facebook: '', instagram: '', youtube: '', twitter: '' },
    requiredUrls: { parts: '', service: '', finance: '' },
    actionUrls: { serviceScheduler: '', partsRequest: '', tradeIn: '', testRide: '', staff: '', blog: '', events: '', testimonials: '', googleReviews: '' },
    departmentPhones: { sales: '', service: '', parts: '' },
    storeHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' },
    serviceHours: { monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: '' }
  };

  $('header img, img.logo, img[id*="logo"], a.navbar-brand img').each((_, el) => {
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
        if (item['@type'] === 'AutoDealer' || item['@type'] === 'LocalBusiness' || item['@type'] === 'AutomotiveBusiness' || item['@type'] === 'MotorcycleDealer' || item['@type'] === 'Organization') {
          if (item.name && !profile.dealershipName) profile.dealershipName = item.name;
          if (item.legalName && !profile.legalCorporateName) profile.legalCorporateName = item.legalName;
          if (item.telephone && !profile.telephoneMainLine) profile.telephoneMainLine = item.telephone;
          if (item.address) {
            profile.streetAddress = item.address.streetAddress || profile.streetAddress;
            profile.city = item.address.addressLocality || profile.city;
            profile.state = item.address.addressRegion || profile.state;
            profile.zipCode = item.address.postalCode || profile.zipCode;
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

  if (!profile.legalCorporateName) {
    const footerText = $('footer, .footer, #footer, .copyright, .footer-copyright, #footer-bottom, .bottom-footer').text().replace(/\s+/g, ' ');
    const cpMatch = footerText.match(/(?:©|Copyright|©)\s*(?:20\d{2}(?:\s*-\s*20\d{2})?)?\s+([^|.\-*•]+?)(?:\s+(?:All\s+Rights|Privacy|Terms|Website|Site\s+Map|Sitemap|$))/i);
    if (cpMatch && cpMatch[1]) {
      let name = cpMatch[1].replace(/all rights reserved/i, '').replace(/inc\/?/i, 'Inc.').replace(/llc\/?/i, 'LLC').trim();
      if (name.length > 2 && name.length < 80) profile.legalCorporateName = name;
    } else {
      const rawMatch = footerText.match(/©\s*(?:20\d{2})?\s*(.{5,50})/);
      if (rawMatch && rawMatch[1]) profile.legalCorporateName = rawMatch[1].split('|')[0].replace(/all rights reserved/i, '').trim();
    }
    if (!profile.legalCorporateName) {
      const title = $('title').text();
      if (title.includes('|')) profile.legalCorporateName = title.split('|').pop().trim();
      else if (title.includes('-')) profile.legalCorporateName = title.split('-').pop().trim();
    }
  }

  // Force Dealership Name into Legal Name if absolutely all else fails
  if (!profile.legalCorporateName && profile.dealershipName) {
     profile.legalCorporateName = `${profile.dealershipName} (Assumed)`;
  }

  const dayMap = { monday: ['monday', 'mon'], tuesday: ['tuesday', 'tue'], wednesday: ['wednesday', 'wed'], thursday: ['thursday', 'thu', 'thr'], friday: ['friday', 'fri'], saturday: ['saturday', 'sat'], sunday: ['sunday', 'sun'] };
  let activeHoursProfile = profile.storeHours; 

  $('footer, .footer, .hours-operation, .hours-block, .contact-us').find('h2, h3, h4, strong, b, th, tr, li, p, div').each((_, el) => {
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
    if (!profile.telephoneMainLine && $(el).is('a[href^="tel:"]')) profile.telephoneMainLine = cleanPhone;
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

    const buildUrl = (path) => { try { return new URL(path, currentUrl).toString(); } catch { return path; } };

    if (targetLink.includes('facebook.com/') && !profile.socialLinks.facebook) profile.socialLinks.facebook = href;
    if (targetLink.includes('instagram.com/') && !profile.socialLinks.instagram) profile.socialLinks.instagram = href;
    if (targetLink.includes('youtube.com/') && !profile.socialLinks.youtube) profile.socialLinks.youtube = href;
    if ((targetLink.includes('twitter.com/') || targetLink.includes('x.com/')) && !profile.socialLinks.twitter) profile.socialLinks.twitter = href;

    if ((targetLink.includes('/parts') || targetLink.includes('parts-department')) && !profile.requiredUrls.parts) profile.requiredUrls.parts = buildUrl(href);
    if ((targetLink.includes('/service') || targetLink.includes('service-department')) && !profile.requiredUrls.service) profile.requiredUrls.service = buildUrl(href);
    if ((targetLink.includes('/finance') || targetLink.includes('/credit')) && !profile.requiredUrls.finance) profile.requiredUrls.finance = buildUrl(href);

    if ((targetLink.includes('schedule') || targetLink.includes('appointment')) && !profile.actionUrls.serviceScheduler) profile.actionUrls.serviceScheduler = buildUrl(href);
    if (targetLink.includes('parts-request') && !profile.actionUrls.partsRequest) profile.actionUrls.partsRequest = buildUrl(href);
    if ((targetLink.includes('value-your-trade') || targetLink.includes('trade-in')) && !profile.actionUrls.tradeIn) profile.actionUrls.tradeIn = buildUrl(href);
    if ((targetLink.includes('test-ride') || targetLink.includes('schedule-ride')) && !profile.actionUrls.testRide) profile.actionUrls.testRide = buildUrl(href);
    
    const isStaffLink = targetLink.includes('/staff') || targetLink.includes('/crew') || targetLink.includes('/our-team') || targetLink.includes('/meet-the-team') || targetLink.includes('/dealership-staff') || anchorText.includes('meet the team') || anchorText.includes('our crew') || anchorText === 'staff' || anchorText === 'our team';
    if (isStaffLink && !profile.actionUrls.staff && !targetLink.includes('join-our-team')) profile.actionUrls.staff = buildUrl(href);

    if ((targetLink.includes('/blog') || targetLink.includes('/news') || targetLink.includes('/articles')) && !profile.actionUrls.blog) profile.actionUrls.blog = buildUrl(href);
    if ((targetLink.includes('/events') || targetLink.includes('/calendar')) && !profile.actionUrls.events) profile.actionUrls.events = buildUrl(href);
    
    if (
      safeHref.includes('search.google.com/local/writereview') || 
      safeHref.includes('search.google.com/local/reviews') || 
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

    if (!profile.actionUrls.googleReviews) {
      if ((safeHref.includes('birdeye.com') || safeHref.includes('podium.com') || safeHref.includes('broadly.com')) && anchorText.includes('review')) {
        profile.actionUrls.googleReviews = href || 'Widget Script Integrated';
      }
    }
  });

  if (!profile.actionUrls.googleReviews) {
    $('script').each((_, el) => {
      const src = $(el).attr('src')?.toLowerCase() || '';
      if (src.includes('elfsight.com') || src.includes('podium.com') || src.includes('birdeye.com')) profile.actionUrls.googleReviews = `Widget Script Installed (${src})`;
    });
  }

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
// 5. URL DEDUPLICATION AND LINK EXTRACTION
// ============================================================================
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