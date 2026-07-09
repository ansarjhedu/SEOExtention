// src/utils/excelExporter.js

import * as XLSX from 'xlsx';

export const exportCrawlDataToExcel = (groupedData, domainName, profileData) => {
  if (!groupedData) return;

  const wb = XLSX.utils.book_new();

  const autoSizeColumns = (worksheet, data) => {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const colWidths = keys.map(key => {
      const maxColLength = Math.max(
        key.length,
        ...data.map(row => (row[key] ? row[key].toString().length : 0))
      );
      return { wch: Math.min(maxColLength + 2, 80) }; 
    });
    worksheet['!cols'] = colWidths;
  };

  const getStatus = (val) => {
    if (!val || val === 'MISSING' || val === '' || val === '0%') return 'MISSING';
    return 'VERIFIED';
  };

  // ============================================================================
  // TAB 1: ENTITY, NAP & GBP DATA
  // ============================================================================
  const qaRows = [];
  const pushEntity = (field, value, customTier = null, evidence = 'Extracted via DOM') => {
    const safeVal = value && String(value).trim() !== '' ? value : 'MISSING';
    const tier = customTier || getStatus(safeVal);
    qaRows.push({ 'Data Field': field, 'Extracted Value': safeVal, 'Verification Status': tier, 'Source/Evidence': evidence });
  };

  pushEntity('Dealership Name', profileData?.dealershipName);
  pushEntity('Legal / Corporate Name', profileData?.legalCorporateName, null, 'Footer / Terms Page');
  pushEntity('Physical Address', [profileData?.streetAddress, profileData?.city, profileData?.state, profileData?.zipCode].filter(Boolean).join(', '));
  pushEntity('Main Phone Number', profileData?.telephoneMainLine);
  pushEntity('Department Phone (Sales)', profileData?.departmentPhones?.sales);
  pushEntity('Department Phone (Service)', profileData?.departmentPhones?.service);
  pushEntity('Department Phone (Parts)', profileData?.departmentPhones?.parts);
  pushEntity('Website Platform', profileData?.platform, null, 'Source Code Fingerprint');
  pushEntity('Logo URL', profileData?.logoUrl);
  pushEntity('Google Business Profile URL', profileData?.googleBusinessUrl, null, 'Map Embed Source');
  pushEntity('Google Maps URL', profileData?.googleBusinessUrl, 'INFERRED', 'Derived from GBP Data');
  pushEntity('GPS Latitude', profileData?.latitude, 'INFERRED', 'Map Embed Coordinates');
  pushEntity('GPS Longitude', profileData?.longitude, 'INFERRED', 'Map Embed Coordinates');
  pushEntity('Google Review URL', profileData?.actionUrls?.googleReviews);
  
  // Store Hours
  ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].forEach(d => {
      const day = d.charAt(0).toUpperCase() + d.slice(1);
      pushEntity(`Sales Hours — ${day}`, profileData?.storeHours?.[d]);
      pushEntity(`Service Hours — ${day}`, profileData?.serviceHours?.[d]);
  });

  // Action / Trust URLs
  pushEntity('Social Profile: Facebook', profileData?.socialLinks?.facebook);
  pushEntity('Social Profile: Instagram', profileData?.socialLinks?.instagram);
  pushEntity('Social Profile: YouTube', profileData?.socialLinks?.youtube);
  pushEntity('Social Profile: Twitter/X', profileData?.socialLinks?.twitter);
  pushEntity('About / Our Dealership Page URL', profileData?.actionUrls?.staff || groupedData?.staticPages?.find(l => l.text.toLowerCase().includes('about'))?.url);
  pushEntity('Contact Page URL', groupedData?.staticPages?.find(l => l.text.toLowerCase().includes('contact'))?.url);
  pushEntity('Careers / Employment Page URL', profileData?.requiredUrls?.careers);
  pushEntity('Reviews / Testimonials Page URL', profileData?.actionUrls?.testimonials);

  const wsEntity = XLSX.utils.json_to_sheet(qaRows);
  autoSizeColumns(wsEntity, qaRows);
  XLSX.utils.book_append_sheet(wb, wsEntity, 'Entity & QA Data');

  // ============================================================================
  // TAB 2: SHOWROOMS & BRANDS
  // ============================================================================
  const brandRows = [];
  const processShowrooms = (links, type) => {
    (links || []).forEach(link => {
      brandRows.push({
        'Brand Name': link.brandName || 'N/A',
        'Brand / Showroom Page URL': link.url,
        'Parent Manufacturer': 'INFERRED', // Will require cross-reference dictionary later
        'Product Line / Category': link.vehicleType || 'N/A',
        'Anchor / Link Text': link.text,
        'Page Type': type,
        'Verification Status': 'VERIFIED'
      });
    });
  };
  processShowrooms(groupedData?.collections?.brandDirectories, 'Brand Directory');
  processShowrooms(groupedData?.collections?.brandModelLists, 'Model List');
  
  if (brandRows.length > 0) {
    const wsBrands = XLSX.utils.json_to_sheet(brandRows);
    autoSizeColumns(wsBrands, brandRows);
    XLSX.utils.book_append_sheet(wb, wsBrands, 'Showrooms & Brands');
  }

  // ============================================================================
  // TAB 3: COLLECTION / CATEGORY (INVENTORY HUB) PAGES
  // ============================================================================
  const hubRows = [];
  const processHubs = (links, type, condition) => {
    (links || []).forEach(link => {
      hubRows.push({
        'Collection Page URL': link.url,
        'Anchor Text': link.text,
        'Collection Type': type,
        'Brand Tag': link.brandName || 'Mixed/All',
        'Condition': condition,
        'Verification Status': 'VERIFIED'
      });
    });
  };
  processHubs(groupedData?.inventory?.newInventory?.mainLinks, 'New Inventory Hub', 'New');
  processHubs(groupedData?.inventory?.usedInventory?.mainLinks, 'Used Inventory Hub', 'Used');
  processHubs(groupedData?.inventory?.generalInventory?.mainLinks, 'General Inventory Hub', 'All');

  if (hubRows.length > 0) {
    const wsHubs = XLSX.utils.json_to_sheet(hubRows);
    autoSizeColumns(wsHubs, hubRows);
    XLSX.utils.book_append_sheet(wb, wsHubs, 'Collection Pages');
  }

  // ============================================================================
  // TAB 4: VEHICLE PRODUCTS & PRICING
  // ============================================================================
  const productRows = [];
  const addProducts = (vehicles, conditionLabel) => {
    (vehicles || []).forEach(link => {
      const hasPrice = link.price && link.price !== 'Missing' && link.price !== '';
      productRows.push({
        'Product Detail Page URL': link.url || '',
        'Anchor / Title Text': link.text || '',
        'Condition': conditionLabel,
        'Year': link.year || 'MISSING',
        'Brand': link.brandName || 'MISSING',
        'Model Name': link.modelName || 'MISSING',
        'Vehicle / Product Type': link.vehicleType || 'Vehicle',
        'Price (as listed)': link.price || 'MISSING',
        'Price Tag / Type': link.priceType || 'MISSING',
        'MSRP': link.msrp || 'MISSING',
        'Retail Price': link.retailPrice || 'MISSING', // 🚨 NEW
        'Sale Price': link.salePrice || 'MISSING',
        'Selling Price': link.sellingPrice || 'MISSING', // 🚨 NEW
        'Monthly Payment / Financing Price': link.monthlyPayment || 'MISSING',
        'Info & Specifications': link.specs || 'MISSING',
        'Verification Status': hasPrice || link.modelName !== 'MISSING' ? 'VERIFIED' : 'MISSING'
      });
    });
  };
  addProducts(groupedData?.inventory?.newInventory?.vehicles, 'New');
  addProducts(groupedData?.inventory?.usedInventory?.vehicles, 'Used');
  addProducts(groupedData?.inventory?.generalInventory?.vehicles, 'General');

  if (productRows.length > 0) {
    const wsProd = XLSX.utils.json_to_sheet(productRows);
    autoSizeColumns(wsProd, productRows);
    XLSX.utils.book_append_sheet(wb, wsProd, 'Vehicle Products');
  }

  // ============================================================================
  // TAB 5: SERVICE DEPARTMENT
  // ============================================================================
  const serviceRows = [{
    'Service Department Page URL': profileData?.requiredUrls?.service || 'MISSING',
    'Service Scheduler URL': profileData?.actionUrls?.serviceScheduler || 'MISSING',
    'Brands Serviced': profileData?.serviceDetails?.brandsServiced?.join(', ') || 'MISSING',
    'Repair Types / Specialties Listed': profileData?.serviceDetails?.claims?.join(', ') || 'MISSING',
    'Verification Status': profileData?.requiredUrls?.service ? 'VERIFIED' : 'MISSING'
  }];
  const wsService = XLSX.utils.json_to_sheet(serviceRows);
  autoSizeColumns(wsService, serviceRows);
  XLSX.utils.book_append_sheet(wb, wsService, 'Service Dept');

  // ============================================================================
  // TAB 6: PAINT & BODY SHOP
  // ============================================================================
  const bodyRows = [{
    'Paint / Body Shop Page URL': profileData?.requiredUrls?.bodyShop || 'MISSING',
    'Collision Repair Services Offered': profileData?.bodyShopDetails?.servicesOffered?.join(', ') || 'MISSING',
    'Verification Status': profileData?.requiredUrls?.bodyShop ? 'VERIFIED' : 'MISSING'
  }];
  const wsBody = XLSX.utils.json_to_sheet(bodyRows);
  autoSizeColumns(wsBody, bodyRows);
  XLSX.utils.book_append_sheet(wb, wsBody, 'Paint & Body Shop');

  // ============================================================================
  // TAB 7: PARTS DEPARTMENT
  // ============================================================================
  const partsRows = [{
    'Parts Department Page URL': profileData?.requiredUrls?.parts || 'MISSING',
    'Request Parts / Order Form URL': profileData?.actionUrls?.partsRequest || 'MISSING',
    'OEM Parts Support': profileData?.partsDetails?.oemSupport ? 'VERIFIED' : 'MISSING',
    'Aftermarket Parts Support': profileData?.partsDetails?.aftermarketSupport ? 'VERIFIED' : 'MISSING',
    'Verification Status': profileData?.requiredUrls?.parts ? 'VERIFIED' : 'MISSING'
  }];
  const wsParts = XLSX.utils.json_to_sheet(partsRows);
  autoSizeColumns(wsParts, partsRows);
  XLSX.utils.book_append_sheet(wb, wsParts, 'Parts Dept');

  // ============================================================================
  // TAB 8: FINANCE & PROMOTIONS
  // ============================================================================
  const promoRows = [];
  // Insert the main finance info first
  promoRows.push({
    'Finance Page URL': profileData?.requiredUrls?.finance || 'MISSING',
    'Named Lenders': profileData?.financeDetails?.lendingPartners?.join(', ') || 'MISSING',
    'Promotion Title / Offer Text': 'N/A',
    'Verification Status': profileData?.requiredUrls?.finance ? 'VERIFIED' : 'MISSING'
  });
  
  // Then list out explicit promotion links found
  (groupedData?.promotions || []).forEach(link => {
    promoRows.push({
      'Finance Page URL': link.url,
      'Named Lenders': 'N/A',
      'Promotion Title / Offer Text': link.text,
      'Verification Status': 'VERIFIED'
    });
  });

  const wsPromo = XLSX.utils.json_to_sheet(promoRows);
  autoSizeColumns(wsPromo, promoRows);
  XLSX.utils.book_append_sheet(wb, wsPromo, 'Finance & Promotions');

  // ============================================================================
  // TAB 9: BLOG / CONTENT PAGES
  // ============================================================================
  const blogRows = [];
  (groupedData?.blogs || []).forEach(link => {
    blogRows.push({
      'Blog / Article URL': link.url,
      'Blog Title': link.text,
      'Target Keyword(s) Found': 'INFERRED', // Handled later via semantic analysis
      'Verification Status': 'VERIFIED'
    });
  });
  
  if (blogRows.length > 0) {
    const wsBlog = XLSX.utils.json_to_sheet(blogRows);
    autoSizeColumns(wsBlog, blogRows);
    XLSX.utils.book_append_sheet(wb, wsBlog, 'Blog Content');
  }

  // ============================================================================
  // TAB 10: SITE HEALTH & QA (404s, MISSING DATA)
  // ============================================================================
  const healthRows = [];
  (groupedData?.deadLinks || []).forEach(link => {
    healthRows.push({ 'Issue Type': '404 / Broken Link', 'URL': link.url, 'Context': link.text, 'Status': 'VERIFIED ERROR' });
  });
  
  if (!profileData?.requiredUrls?.finance) healthRows.push({ 'Issue Type': 'Missing Required Core Page', 'URL': 'MISSING', 'Context': 'Finance / Credit Page', 'Status': 'VERIFIED ERROR' });
  if (!profileData?.requiredUrls?.parts) healthRows.push({ 'Issue Type': 'Missing Required Core Page', 'URL': 'MISSING', 'Context': 'Parts Department Page', 'Status': 'VERIFIED ERROR' });
  if (!profileData?.actionUrls?.googleReviews) healthRows.push({ 'Issue Type': 'Missing Reputation Link', 'URL': 'MISSING', 'Context': 'Google Review URL missing', 'Status': 'VERIFIED ERROR' });

  if (healthRows.length > 0) {
    const wsHealth = XLSX.utils.json_to_sheet(healthRows);
    autoSizeColumns(wsHealth, healthRows);
    XLSX.utils.book_append_sheet(wb, wsHealth, 'Site Health QA');
  }

  // ============================================================================
  // TAB 11: STATIC & MISCELLANEOUS PAGES
  // ============================================================================
  const staticRows = [];
  (groupedData?.staticPages || []).forEach(link => {
    staticRows.push({ 'Page URL': link.url, 'Anchor / Page Title': link.text, 'Page Category': 'Static Content' });
  });
  (groupedData?.other || []).forEach(link => {
    staticRows.push({ 'Page URL': link.url, 'Anchor / Page Title': link.text, 'Page Category': 'Misc/Uncategorized' });
  });

  if (staticRows.length > 0) {
    const wsStatic = XLSX.utils.json_to_sheet(staticRows);
    autoSizeColumns(wsStatic, staticRows);
    XLSX.utils.book_append_sheet(wb, wsStatic, 'Static & Misc');
  }

  // ============================================================================
  // SAVE WORKBOOK
  // ============================================================================
  XLSX.writeFile(wb, `Maxxopp_Audit_${domainName}_${new Date().toISOString().split('T')[0]}.xlsx`);
};

export const constructGroupedDataFromFlatList = (flatLinks) => {
  const grouped = {
    collections: { brandDirectories: [], brandModelLists: [], modelCatalogFilters: [] },
    inventory: {
      newInventory: { mainLinks: [], vehicles: [] },
      usedInventory: { mainLinks: [], vehicles: [] },
      generalInventory: { mainLinks: [], vehicles: [] }
    },
    promotions: [],
    parts: [],
    blogs: [], 
    staticPages: [],
    deadLinks: [], // Added for Tab 10
    other: []
  };

  (flatLinks || []).forEach(link => {
    if (link.category === 'collection') {
      if (link.subCategory === 'brand-directory') grouped.collections.brandDirectories.push(link);
      else if (link.subCategory === 'brand-model-list') grouped.collections.brandModelLists.push(link);
      else grouped.collections.modelCatalogFilters.push(link);
    } 
    else if (link.category === 'product') {
      if (link.subCategory === 'new-product') grouped.inventory.newInventory.vehicles.push(link);
      else if (link.subCategory === 'used-product') grouped.inventory.usedInventory.vehicles.push(link);
      else grouped.inventory.generalInventory.vehicles.push(link);
    } 
    else if (link.category === 'inventory') {
      if (link.subCategory === 'new-inventory') grouped.inventory.newInventory.mainLinks.push(link);
      else if (link.subCategory === 'used-inventory') grouped.inventory.usedInventory.mainLinks.push(link);
      else grouped.inventory.generalInventory.mainLinks.push(link);
    }
    else if (link.category === 'blog') {
      grouped.blogs.push(link);
    }
    else if (link.category === 'dead_link') {
      grouped.deadLinks.push(link);
    }
    else if (link.category === 'page') {
      if (link.subCategory === 'promotion-page') grouped.promotions.push(link);
      else if (link.subCategory === 'parts-page' || link.subCategory === 'service-page') grouped.parts.push(link);
      else grouped.staticPages.push(link);
    } 
    else {
      grouped.other.push(link);
    }
  });

  return grouped;
};