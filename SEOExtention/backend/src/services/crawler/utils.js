// services/crawler/utils.js

export const assetExtensions = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.ico',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.flv', '.wmv', '.ogg', '.webm',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.xml', '.json', '.css', '.js'
];

const KNOWN_BRANDS_SET = new Set(['yamaha', 'kawasaki', 'cfmoto', 'ktm', 'honda', 'suzuki', 'polaris', 'can-am']);
const CATEGORY_KEYWORDS = new Set(['atvs', 'atv', 'motorcycles', 'motorcycle', 'utility-vehicles', 'utility-vehicle', 'watercraft', 'scooters', 'scooter']);

export const getCleanDomain = (urlStr) => {
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
};

export function isAssetUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname.toLowerCase();
    return assetExtensions.some(ext => pathname.endsWith(ext));
  } catch (e) {
    return false;
  }
}

/**
 * Normalizes URL paths and strips infinite filter sorting parameters.
 * Preserves critical identifiers such as id, stock, and vin using a strict whitelist.
 */
export function canonicalizeUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    url.hash = '';

    // 嚴格白名單模式：僅保留分頁、產品 ID、庫存或車身號碼所需的必要參數。
    // 自動刪除 ModuleGuid、排序（sort）、方向（direction）及各種篩選參數，以防爬蟲陷入無限重覆路徑的陷阱。
    const whitelistParams = new Set(['page', 'p', 'pg', 'offset', 'id', 'vehicleid', 'stock', 'vin']);
    const params = [...url.searchParams.entries()];

    for (const [key] of params) {
      if (!whitelistParams.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    let cleanUrl = url.toString();
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    return cleanUrl;
  } catch (e) {
    return urlStr;
  }
}

/**
 * Extracts auto details from vehicle detail paths.
 */
export function extractAutoDetailsFromUrl(urlStr) {
  const details = {
    vehicleType: 'Vehicle',
    brandName: '',
    modelName: '',
    year: ''
  };

  try {
    const url = new URL(urlStr);
    const pathname = decodeURIComponent(url.pathname).toLowerCase();
    const tokens = pathname.split(/[\/\-_%+]+/).filter(Boolean);

    let yearIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (/^(19[8-9]\d|20[0-2]\d)$/.test(tokens[i])) {
        yearIdx = i;
        details.year = tokens[i];
        break;
      }
    }

    const foundBrand = tokens.find(t => KNOWN_BRANDS_SET.has(t));
    if (foundBrand) {
      details.brandName = foundBrand.charAt(0).toUpperCase() + foundBrand.slice(1);
    }

    const foundType = tokens.find(t => CATEGORY_KEYWORDS.has(t));
    if (foundType) {
      details.vehicleType = foundType.charAt(0).toUpperCase() + foundType.slice(1);
    }

    if (yearIdx !== -1 && foundBrand) {
      const brandIdx = tokens.indexOf(foundBrand);
      if (brandIdx !== -1 && brandIdx < yearIdx) {
        const modelTokens = tokens.slice(brandIdx + 1, yearIdx);
        if (modelTokens.length > 0) {
          details.modelName = modelTokens.map(t => t.toUpperCase()).join(' ');
        }
      }
    }
  } catch (e) {}

  return details;
}

/**
 * Maps URLs to distinct categories.
 * Implements an Inclusion-Exclusion engine to accurately capture product VDPs across all platforms.
 */
export function getUrlCategoryAndSub(urlStr) {
  const lowerUrl = urlStr.toLowerCase();
  const url = new URL(urlStr);
  const pathname = decodeURIComponent(url.pathname).toLowerCase();
  const tokens = pathname.split(/[\/\-_%+]+/).filter(Boolean);

  // --- 1. STRICT EXCLUSIONS (Absolutely NOT a product) ---
  const isExcludedFromProducts = 
    lowerUrl.includes('/brands') ||
    lowerUrl.includes('/manufacturer-models') ||
    lowerUrl.includes('/model-list') ||
    lowerUrl.includes('/promotions') ||
    lowerUrl.includes('/oem-promotions') ||
    lowerUrl.includes('/promotion') ||
    lowerUrl.includes('/promo') ||
    lowerUrl.includes('/parts') ||
    lowerUrl.includes('/accessories') ||
    lowerUrl.includes('/parts-department') ||
    lowerUrl.includes('/contact') ||
    lowerUrl.includes('/about');

  // --- 2. INCLUSION HEURISTICS (Must match at least one to be a product) ---
  const hasYear = /\b(19[8-9]\d|20[0-2]\d)\b/.test(lowerUrl);
  const hasBrand = tokens.some(t => KNOWN_BRANDS_SET.has(t));
  const hasCategory = tokens.some(t => CATEGORY_KEYWORDS.has(t));
  const hasVdpQueryId = 
    url.searchParams.has('id') || 
    url.searchParams.has('vehicleid') || 
    url.searchParams.has('stock') || 
    url.searchParams.has('vin') ||
    lowerUrl.includes('inventorydetail');

  const hasVdpGuidSignature = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(lowerUrl);

  const isVdp = !isExcludedFromProducts && (
    (hasYear && hasBrand) ||
    (hasBrand && hasCategory) ||
    hasVdpQueryId ||
    hasVdpGuidSignature
  );

  if (isVdp) {
    let condition = 'general-product';
    if (lowerUrl.includes('new') || lowerUrl.includes('newinventory')) {
      condition = 'new-product';
    } else if (lowerUrl.includes('used') || lowerUrl.includes('pre-owned') || lowerUrl.includes('usedinventory')) {
      condition = 'used-product';
    }
    return { category: 'product', subCategory: condition };
  }

  // --- 3. OTHER CATEGORY MAPPINGS ---
  if (lowerUrl.includes('/parts') || lowerUrl.includes('/accessories') || lowerUrl.includes('/parts-department')) {
    return { category: 'page', subCategory: 'parts-page' };
  }

  if (lowerUrl.includes('/promotions') || lowerUrl.includes('/oem-promotions') || lowerUrl.includes('/promotion') || lowerUrl.includes('/promo')) {
    return { category: 'page', subCategory: 'promotion-page' };
  }

  if (lowerUrl.includes('/manufacturer-models') || lowerUrl.includes('/model-list')) {
    return { category: 'collection', subCategory: 'brand-model-list' };
  }

  const isBrandDropdownLink = lowerUrl.includes('/brands/') && !lowerUrl.includes('/manufacturer-models') && tokens.some(t => KNOWN_BRANDS_SET.has(t));
  if (isBrandDropdownLink) {
    return { category: 'collection', subCategory: 'brand-directory' };
  }

  const isCatalogFilter = lowerUrl.includes('/brands/') && (hasCategory || hasYear || tokens.some(t => ['adventure', 'cforce', 'uforce', 'zforce', 'sport', 'naked', 'cl-x'].includes(t)));
  if (isCatalogFilter) {
    return { category: 'collection', subCategory: 'model-catalog-filter' };
  }

  if (lowerUrl.includes('/new-vehicles') || lowerUrl.includes('/new-inventory')) {
    return { category: 'inventory', subCategory: 'new-inventory' };
  }
  if (lowerUrl.includes('/used-vehicles') || lowerUrl.includes('/used-inventory')) {
    return { category: 'inventory', subCategory: 'used-inventory' };
  }
  if (lowerUrl.includes('/inventory') || lowerUrl.includes('/search') || lowerUrl.includes('searchinventory')) {
    return { category: 'inventory', subCategory: 'general-inventory' };
  }

  const staticPagePaths = ['/about', '/contact', '/faq', '/privacy', '/terms'];
  try {
    const pathname = url.pathname.toLowerCase();
    if (pathname === '/' || staticPagePaths.some(path => pathname === path || pathname === path + '/')) {
      return { category: 'page', subCategory: 'static-page' };
    }
  } catch (e) {}

  return { category: 'other', subCategory: '' };
}