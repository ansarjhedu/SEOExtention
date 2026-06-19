// services/crawler/parser.js

import * as cheerio from 'cheerio';
import { getCleanDomain, isAssetUrl, getUrlCategoryAndSub, extractAutoDetailsFromUrl, canonicalizeUrl } from './utils.js';

/**
 * 輔助函式：按星期/天（Day-by-Day）精準提取營業時間。
 * 會自動搜尋包含特定關鍵字（如 sales 或 service）且符合星期與時間格式的文本行。
 */
function extractHoursByDays($, keyword) {
  const schedule = [];
  // 匹配星期的英文縮寫與全稱
  const daysRegex = /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/i;
  // 匹配時間範圍（如 9:00 am - 6:00 pm, 8am-5pm 等）
  const timeRegex = /\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i;

  // 1. 先從包含關鍵字的特定 HTML 元素中尋找
  $('*').each((_, el) => {
    const text = $(el).text().trim();
    // 限制長度小於 500 字，避免抓到整個 body 造成混亂
    if (new RegExp(keyword, 'i').test(text) && daysRegex.test(text) && text.length < 500) {
      // 依換行符、逗號、分號或多個空格將文本拆分成單行
      const lines = text.split(/[\n,;]|\s{3,}/);
      lines.forEach(line => {
        const cleanLine = line.trim().replace(/\s+/g, ' ');
        // 如果該單行同時包含星期與時間格式，且長度合理，則視為有效營業時間
        if (daysRegex.test(cleanLine) && timeRegex.test(cleanLine) && cleanLine.length < 100) {
          schedule.push(cleanLine);
        }
      });
    }
  });

  // 2. 備用方案：若上述精準查找未果，則逐行掃描整頁 Body 文本
  if (schedule.length === 0) {
    const bodyLines = $('body').text().split('\n');
    bodyLines.forEach(line => {
      const cleanLine = line.trim().replace(/\s+/g, ' ');
      if (new RegExp(keyword, 'i').test(cleanLine) && daysRegex.test(cleanLine) && timeRegex.test(cleanLine) && cleanLine.length < 100) {
        schedule.push(cleanLine);
      }
    });
  }

  // 去除重覆項，並以 " | " 串接成乾淨的一行
  return [...new Set(schedule)].join(' | ');
}

/**
 * 將扁平的已發現連結列表整理為結構化的分類，供前端 UI 與 Excel 匯出模組直接使用。
 * 將 Promotions（優惠活動）與 Parts（零件）獨立抽出，避免與常規 Collection 與 Pages 混淆。
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
    promotions: [],      // 獨立的促銷活動頁面
    parts: [],           // 獨立的零件／配件頁面
    staticPages: [],     // 常規靜態頁面（如：About、Contact）
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
 * 解析頁面中的 MSRP/價格資訊。
 */
export function extractPageMetadata(html) {
  const $ = cheerio.load(html);
  let extractedPrice = '';

  // 優先檢查 JSON-LD 結構化資料
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

  // 備用正則表達式匹配
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
 * 提取車行詳盡資訊（名稱、公司名、地址、電話、營業時間、經緯度坐標、金融與售後細節）。
 * 已更新：營業時間將精準依「星期」逐天比對提取。
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

  // 1. JSON-LD 結構化資料提取
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

  // 2. 頁面/頁尾聯絡資訊備用提取
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

  // 3. 經緯度與 Google 地圖連結提取
  $('iframe[src*="google.com/maps"]').each((_, el) => {
    const src = $(el).attr('src');
    profile.googleBusinessUrl = src;
    const geoMatch = src.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
    if (geoMatch) {
      profile.longitude = geoMatch[1];
      profile.latitude = geoMatch[2];
    }
  });

  // 4. 精準按「星期/天（Day-by-Day）」比對提取營業時間
  profile.salesHours = extractHoursByDays($, 'sales') || extractHoursByDays($, 'showroom') || 'Contact Dealer';
  profile.serviceHours = extractHoursByDays($, 'service') || extractHoursByDays($, 'repair') || 'Contact Dealer';

  // 5. 貸款、專案與技術政策掃描
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

/**
 * 解析頁面連結並將其去重、白名單化。
 * 商品（VDP）連結會在此處立即推入 queue 中，進行即時（On-the-fly）價格掃描。
 */
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

      // 嚴格的分頁限制保護，防止無限爬行深層空存檔
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

      // 所有未掃描的 canonical 連結（包括商品與頁面）皆在此推入爬取佇列中，進行即時（On-the-fly）價格掃描。
      if (!session.visitedUrls.has(cleanUrl) && !session.queue.includes(cleanUrl)) {
        session.queue.push(cleanUrl);
      }
    } catch (e) {}
  });

  return newlyDiscoveredPageLinks;
}