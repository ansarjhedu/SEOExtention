// services/crawler/parser.js

import * as cheerio from 'cheerio';
import { getCleanDomain, isAssetUrl, getUrlCategoryAndSub, extractAutoDetailsFromUrl, canonicalizeUrl } from './utils.js';

/**
 * Groups discovered links into isolated tabs.
 */
export function groupDiscoveredLinks(links) {
  const grouped = {
    collections: {
      brandDirectories: [],
      brandModelLists: [],
      modelCatalogFilters: []
    },
    inventory: {
      newInventory: { mainLinks: [], vehicles: [] },
      usedInventory: { mainLinks: [], vehicles: [] },
      generalInventory: { mainLinks: [], vehicles: [] }
    },
    promotions: [],      
    parts: [],           
    staticPages: [],
    other: []
  };

  for (const link of links) {
    if (link.category === 'collection') {
      if (link.subCategory === 'brand-directory') {
        grouped.collections.brandDirectories.push(link);
      } else if (link.subCategory === 'brand-model-list') {
        grouped.collections.brandModelLists.push(link);
      } else {
        grouped.collections.modelCatalogFilters.push(link);
      }
    } 
    else if (link.category === 'inventory') {
      if (link.subCategory === 'new-inventory') {
        grouped.inventory.newInventory.mainLinks.push(link);
      } else if (link.subCategory === 'used-inventory') {
        grouped.inventory.usedInventory.mainLinks.push(link);
      } else {
        grouped.inventory.generalInventory.mainLinks.push(link);
      }
    } 
    else if (link.category === 'product') {
      if (link.subCategory === 'new-product') {
        grouped.inventory.newInventory.vehicles.push(link);
      } else if (link.subCategory === 'used-product') {
        grouped.inventory.usedInventory.vehicles.push(link);
      } else {
        grouped.inventory.generalInventory.vehicles.push(link);
      }
    } 
    else if (link.category === 'page') {
      if (link.subCategory === 'promotion-page') {
        grouped.promotions.push(link);
      } else if (link.subCategory === 'parts-page') {
        grouped.parts.push(link);
      } else {
        grouped.staticPages.push(link);
      }
    } 
    else {
      grouped.other.push(link);
    }
  }

  return grouped;
}

/**
 * Extracts price details from a vehicle page DOM.
 */
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
          if (item.offers?.price) {
            extractedPrice = `$${item.offers.price}`;
          }
        }
      }
    } catch (e) {}
  });

  if (!extractedPrice) {
    const bodyText = $('body').text();
    const match = bodyText.match(/(?:price|msrp)\s*:?\s*\$?([0-9,]{3,8})/i);
    if (match) {
      extractedPrice = `$${match[1]}`;
    }
  }

  return { price: extractedPrice };
}

/**
 * Extracts and maps page-level corporate details.
 */
export function extractDealershipProfile(html, currentUrl) {
  const $ = cheerio.load(html);
  const profile = {
    dealershipName: '',
    legalCorporateName: '',
    dbaAlternateName: '',
    streetAddress: '',
    city: '',
    state: '',
    zipCode: '',
    telephoneMainLine: '',
    salesHours: '',
    serviceHours: '',
    latitude: '',
    longitude: '',
    googleBusinessUrl: '',
    lendingPartners: [],
    programsOffered: [],
    claims: [],
    tiers: []
  };

  const bodyText = $('body').text();
  const lowerUrl = currentUrl.toLowerCase();

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (item['@type'] === 'AutoDealer' || item['@type'] === 'LocalBusiness' || item['@type'] === 'AutomotiveBusiness') {
          if (item.name) profile.dealershipName = item.name;
          if (item.legalName) profile.legalCorporateName = item.legalName;
          if (item.alternateName) profile.dbaAlternateName = item.alternateName;
          if (item.telephone) profile.telephoneMainLine = item.telephone;

          if (item.address) {
            profile.streetAddress = item.address.streetAddress || '';
            profile.city = item.address.addressLocality || '';
            profile.state = item.address.addressRegion || '';
            profile.zipCode = item.address.postalCode || '';
          }

          if (item.geo) {
            profile.latitude = String(item.geo.latitude || '');
            profile.longitude = String(item.geo.longitude || '');
          }
        }
      }
    } catch (e) {}
  });

  if (!profile.telephoneMainLine) {
    $('a[href^="tel:"]').each((_, el) => {
      if (!profile.telephoneMainLine) {
        profile.telephoneMainLine = $(el).attr('href').replace('tel:', '').trim();
      }
    });
  }

  if (!profile.streetAddress) {
    const footerText = $('footer').text();
    const addressMatch = footerText.match(/(\d+\s+[A-Za-z0-9\s.,]+),\s*([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5})/);
    if (addressMatch) {
      profile.streetAddress = addressMatch[1].trim();
      profile.city = addressMatch[2].trim();
      profile.state = addressMatch[3].trim();
      profile.zipCode = addressMatch[4].trim();
    }
  }

  $('iframe[src*="google.com/maps"]').each((_, el) => {
    const src = $(el).attr('src');
    profile.googleBusinessUrl = src;
    const geoMatch = src.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
    if (geoMatch) {
      profile.longitude = geoMatch[1];
      profile.latitude = geoMatch[2];
    }
  });

  const extractHoursByDays = (keyword) => {
    const schedule = [];
    const daysRegex = /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/i;
    const timeRegex = /\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i;

    $('*').each((_, el) => {
      const text = $(el).text().trim();
      if (new RegExp(keyword, 'i').test(text) && daysRegex.test(text) && text.length < 500) {
        const lines = text.split(/[\n,;]|\s{3,}/);
        lines.forEach(line => {
          const cleanLine = line.trim().replace(/\s+/g, ' ');
          if (daysRegex.test(cleanLine) && timeRegex.test(cleanLine) && cleanLine.length < 100) {
            schedule.push(cleanLine);
          }
        });
      }
    });

    if (schedule.length === 0) {
      const bodyLines = $('body').text().split('\n');
      bodyLines.forEach(line => {
        const cleanLine = line.trim().replace(/\s+/g, ' ');
        if (new RegExp(keyword, 'i').test(cleanLine) && daysRegex.test(cleanLine) && timeRegex.test(cleanLine) && cleanLine.length < 100) {
          schedule.push(cleanLine);
        }
      });
    }
    return [...new Set(schedule)].join(' | ');
  };

  profile.salesHours = extractHoursByDays('sales') || extractHoursByDays('showroom') || 'Contact Dealer';
  profile.serviceHours = extractHoursByDays('service') || extractHoursByDays('repair') || 'Contact Dealer';

  if (lowerUrl.includes('/finance') || lowerUrl.includes('/credit')) {
    const potentialPartners = ['chase', 'wells fargo', 'ally', 'capital one', 'santander', 'toyota financial', 'honda financial', 'yamaha financial'];
    potentialPartners.forEach(bank => {
      if (bodyText.toLowerCase().includes(bank)) {
        profile.lendingPartners.push(bank.toUpperCase());
      }
    });

    const programs = ['military rebate', 'college graduate', 'first-time buyer', 'subprime', 'lease-to-own'];
    programs.forEach(prog => {
      if (bodyText.toLowerCase().includes(prog)) {
        profile.programsOffered.push(prog.toUpperCase());
      }
    });
  }

  if (lowerUrl.includes('/service') || lowerUrl.includes('/parts')) {
    const warrantyClaims = ['150-point inspection', 'carfax certified', 'extended warranty', 'factory warranty', 'free roadside'];
    warrantyClaims.forEach(claim => {
      if (bodyText.toLowerCase().includes(claim)) {
        profile.claims.push(claim.toUpperCase());
      }
    });

    const rates = ['tier 1', 'tier 2', 'sub-prime rate', 'low apr', '0% financing'];
    rates.forEach(rate => {
      if (bodyText.toLowerCase().includes(rate)) {
        profile.tiers.push(rate.toUpperCase());
      }
    });
  }

  return profile;
}

export function parseAndExtractLinks(html, currentUrl, targetUrl, targetDomain, session) {
  const $ = cheerio.load(html);
  const newlyDiscoveredPageLinks = [];

  $('a').each((_, element) => {
    if (session.isTerminated) return;
    const href = $(element).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, currentUrl);
      const cleanUrl = canonicalizeUrl(absoluteUrl.toString());

      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) return;
      if (isAssetUrl(cleanUrl)) return;

      const isInternal = getCleanDomain(cleanUrl) === targetDomain;
      if (!isInternal) return;

      let anchorText = $(element).text().trim();
      if (!anchorText) {
        const innerImg = $(element).find('img');
        anchorText = innerImg.length
          ? $(innerImg).attr('alt')?.trim() || '[Image Link]'
          : '[No Text]';
      }

      // Pagination protection ceiling
      const pageParam = absoluteUrl.searchParams.get('page') || absoluteUrl.searchParams.get('p') || absoluteUrl.searchParams.get('pg');
      if (pageParam && parseInt(pageParam) > 15) {
        return; 
      }

      const { category, subCategory } = getUrlCategoryAndSub(cleanUrl);
      const urlDetails = extractAutoDetailsFromUrl(cleanUrl);

      const linkRecord = {
        url: cleanUrl,
        text: anchorText || '[No Text]',
        type: 'internal',
        category,
        subCategory,
        statusCode: 200,
        
        vehicleType: urlDetails.vehicleType,
        brandName: urlDetails.brandName,
        modelName: urlDetails.modelName,
        year: urlDetails.year,
        price: '',
        verificationStatus: category === 'product' ? 'missing' : 'not_applicable'
      };

      if (!session.seenUniqueLinks.has(cleanUrl)) {
        session.seenUniqueLinks.add(cleanUrl);
        session.discoveredLinks.push(linkRecord);
        newlyDiscoveredPageLinks.push(linkRecord);
      }

      // CRUCIAL EXCLUSION: Skip product VDPs from the Phase 1 queue.
      // Product pages will be visited and scanned exclusively during Phase 2.
      if (category !== 'product') {
        if (!session.visitedUrls.has(cleanUrl) && !session.queue.includes(cleanUrl)) {
          session.queue.push(cleanUrl);
        }
      }
    } catch (e) {}
  });

  return newlyDiscoveredPageLinks;
}