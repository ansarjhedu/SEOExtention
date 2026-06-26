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

  // ============================================================================
  // 1. ENTITY & QA DATA SHEET
  // ============================================================================
  const qaRows = [];
  
  // Added 'customTier' so we can explicitly flag things as INFERRED when needed
  const pushEntity = (field, value, evidence = 'Extracted via LD-JSON / DOM', customTier = null) => {
    if (value && String(value).trim() !== '') {
      qaRows.push({ 'Field': field, 'Value': value, 'Tier': customTier || 'VERIFIED', 'Evidence': evidence });
    } else {
      qaRows.push({ 'Field': field, 'Value': 'MISSING', 'Tier': 'MISSING', 'Evidence': '' });
    }
  };

  // --- Base Business Info ---
  pushEntity('Dealership Name', profileData?.dealershipName);
  pushEntity('Legal Corporate Name', profileData?.legalCorporateName);
  pushEntity('Address', [profileData?.streetAddress, profileData?.city, profileData?.state, profileData?.zipCode].filter(Boolean).join(', '));
  pushEntity('Telephone Main Line', profileData?.telephoneMainLine);
  pushEntity('Fax Number Line', profileData?.telephoneFax, 'DOM Footprint Regex Search'); // Added
  pushEntity('Website Platform', profileData?.platform, 'Footer / Source Code Regex');
  pushEntity('Logo URL', profileData?.logoUrl, 'Header Image Tag');
  pushEntity('Google Business URL', profileData?.googleBusinessUrl, 'Map iFrame Source');
  
  // Lat/Long are often pulled from iFrames, so we flag them as INFERRED per the prompt rules
  pushEntity('GPS Latitude', profileData?.latitude, 'Map iFrame Regex', 'INFERRED');
  pushEntity('GPS Longitude', profileData?.longitude, 'Map iFrame Regex', 'INFERRED');

  // --- Department Phones ---
  pushEntity('Phone: Sales', profileData?.departmentPhones?.sales, 'DOM Nearby Text Match');
  pushEntity('Phone: Service', profileData?.departmentPhones?.service, 'DOM Nearby Text Match');
  pushEntity('Phone: Parts', profileData?.departmentPhones?.parts, 'DOM Nearby Text Match');

  // --- Required Authority URLs ---
  pushEntity('Required URL: Parts', profileData?.requiredUrls?.parts);
  pushEntity('Required URL: Service', profileData?.requiredUrls?.service);
  pushEntity('Required URL: Finance', profileData?.requiredUrls?.finance);

  // --- Action / Conversion URLs ---
  pushEntity('Action URL: Service Scheduler', profileData?.actionUrls?.serviceScheduler);
  pushEntity('Action URL: Parts Request', profileData?.actionUrls?.partsRequest);
  pushEntity('Action URL: Trade-In / Sell', profileData?.actionUrls?.tradeIn);
  pushEntity('Action URL: Test Ride', profileData?.actionUrls?.testRide);

  // --- Trust / Content URLs ---
  pushEntity('Content URL: Staff / Team', profileData?.actionUrls?.staff);
  pushEntity('Content URL: Blog / News', profileData?.actionUrls?.blog);
  pushEntity('Content URL: Events', profileData?.actionUrls?.events);
  pushEntity('Content URL: Testimonials', profileData?.actionUrls?.testimonials);

  // --- Social Links ---
  pushEntity('Social: Facebook', profileData?.socialLinks?.facebook, 'DOM Anchor Search');
  pushEntity('Social: Instagram', profileData?.socialLinks?.instagram, 'DOM Anchor Search');
  pushEntity('Social: YouTube', profileData?.socialLinks?.youtube, 'DOM Anchor Search');
  pushEntity('Social: Twitter/X', profileData?.socialLinks?.twitter, 'DOM Anchor Search');

  // --- Store Hours ---
  pushEntity('Hours: Monday', profileData?.storeHours?.monday);
  pushEntity('Hours: Tuesday', profileData?.storeHours?.tuesday);
  pushEntity('Hours: Wednesday', profileData?.storeHours?.wednesday);
  pushEntity('Hours: Thursday', profileData?.storeHours?.thursday);
  pushEntity('Hours: Friday', profileData?.storeHours?.friday);
  pushEntity('Hours: Saturday', profileData?.storeHours?.saturday);
  pushEntity('Hours: Sunday', profileData?.storeHours?.sunday);

  // --- Inventory Strategy & Metrics ---
  const totalVehicles = (profileData?.inventoryMetrics?.newCount || 0) + (profileData?.inventoryMetrics?.usedCount || 0);
  
  pushEntity('Total Vehicles Found', totalVehicles > 0 ? totalVehicles : '0', 'Calculated Product URLs', 'INFERRED');
  pushEntity('New Inventory %', profileData?.inventoryMetrics?.newPercentage || '0%', 'Calculated Mix', 'INFERRED');
  pushEntity('Used Inventory %', profileData?.inventoryMetrics?.usedPercentage || '0%', 'Calculated Mix', 'INFERRED');
  
  pushEntity(
    'Priority Brands (Top 5)', 
    profileData?.inventoryMetrics?.topBrands && profileData.inventoryMetrics.topBrands.length > 0 
      ? profileData.inventoryMetrics.topBrands.join(', ') 
      : 'None Detected', 
    'Most Frequent Product Brands', 
    'INFERRED'
  );
  
  pushEntity(
    'Priority Categories (Top 3)', 
    profileData?.inventoryMetrics?.topCategories && profileData.inventoryMetrics.topCategories.length > 0 
      ? profileData.inventoryMetrics.topCategories.join(', ') 
      : 'None Detected', 
    'Most Frequent Vehicle Types', 
    'INFERRED'
  );

  const wsQA = XLSX.utils.json_to_sheet(qaRows);
  autoSizeColumns(wsQA, qaRows);
  XLSX.utils.book_append_sheet(wb, wsQA, 'Entity & QA Data');

  // ============================================================================
  // 2. VEHICLE PRODUCTS SHEET
  // ============================================================================
  const productRows = [];
  const addProductVehicles = (vehicles, conditionLabel) => {
    (vehicles || []).forEach(link => {
      // Ensure verification displays correctly based on price discovery status
      const hasPrice = link.price && link.price !== 'Missing' && link.price !== '';
      const finalStatus = hasPrice ? 'VERIFIED' : 'MISSING';

      productRows.push({
        'URL': link.url || '',
        'Anchor Text': link.text || '',
        'Condition': conditionLabel,
        'Year': link.year || 'N/A',
        'Brand Name': link.brandName || 'N/A',
        'Model Name': link.modelName || 'N/A',
        'Vehicle Type': link.vehicleType || 'Vehicle',
        'Price': link.price || 'Contact Dealer',
        'Verification Status': finalStatus
      });
    });
  };

  addProductVehicles(groupedData?.inventory?.newInventory?.vehicles, 'New');
  addProductVehicles(groupedData?.inventory?.usedInventory?.vehicles, 'Used');
  addProductVehicles(groupedData?.inventory?.generalInventory?.vehicles, 'General');

  if (productRows.length > 0) {
    const wsProd = XLSX.utils.json_to_sheet(productRows);
    autoSizeColumns(wsProd, productRows);
    XLSX.utils.book_append_sheet(wb, wsProd, 'Vehicle Products');
  }
  // ============================================================================
  // 3. INVENTORY COLLECTIONS SHEET
  // ============================================================================
  const inventoryRows = [];
  const addInventoryMainLinks = (mainLinks, conditionLabel) => {
    (mainLinks || []).forEach(link => {
      inventoryRows.push({
        'URL': link.url || '',
        'Anchor Text': link.text || '',
        'Condition Category': conditionLabel,
        'Brand Tag': link.brandName || 'N/A'
      });
    });
  };

  addInventoryMainLinks(groupedData?.inventory?.newInventory?.mainLinks, 'New Inventory Hub');
  addInventoryMainLinks(groupedData?.inventory?.usedInventory?.mainLinks, 'Used Inventory Hub');
  addInventoryMainLinks(groupedData?.inventory?.generalInventory?.mainLinks, 'General Inventory Hub');

  if (inventoryRows.length > 0) {
    const wsInv = XLSX.utils.json_to_sheet(inventoryRows);
    autoSizeColumns(wsInv, inventoryRows);
    XLSX.utils.book_append_sheet(wb, wsInv, 'Inventory Collections');
  }

  // ============================================================================
  // 4. BRANDS & SHOWROOMS SHEET
  // ============================================================================
  const brandRows = [];
  (groupedData?.collections?.brandDirectories || []).forEach(link => {
    brandRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Collection Type': 'Brand Directory' });
  });
  (groupedData?.collections?.brandModelLists || []).forEach(link => {
    brandRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Collection Type': 'Model List' });
  });
  (groupedData?.collections?.modelCatalogFilters || []).forEach(link => {
    brandRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Collection Type': 'Catalog Filter' });
  });

  if (brandRows.length > 0) {
    const wsBrand = XLSX.utils.json_to_sheet(brandRows);
    autoSizeColumns(wsBrand, brandRows);
    XLSX.utils.book_append_sheet(wb, wsBrand, 'Brands & Showrooms');
  }

  // ============================================================================
  // 5. PARTS & SERVICE SHEET
  // ============================================================================
  const partsRows = [];
  (groupedData?.parts || []).forEach(link => {
    partsRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Department': 'Parts/Service' });
  });

  if (partsRows.length > 0) {
    const wsParts = XLSX.utils.json_to_sheet(partsRows);
    autoSizeColumns(wsParts, partsRows);
    XLSX.utils.book_append_sheet(wb, wsParts, 'Parts & Service');
  }

  // ============================================================================
  // 6. PROMOTIONS SHEET
  // ============================================================================
  const promotionRows = [];
  (groupedData?.promotions || []).forEach(link => {
    promotionRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Category': 'Promotion' });
  });

  if (promotionRows.length > 0) {
    const wsPromo = XLSX.utils.json_to_sheet(promotionRows);
    autoSizeColumns(wsPromo, promotionRows);
    XLSX.utils.book_append_sheet(wb, wsPromo, 'Promotions');
  }

  // ============================================================================
  // 7. STATIC PAGES & MISC SHEET
  // ============================================================================
  const staticRows = [];
  (groupedData?.staticPages || []).forEach(link => {
    staticRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Category': 'Static Page' });
  });
  (groupedData?.other || []).forEach(link => {
    staticRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Category': 'Other' });
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
    staticPages: [],
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
    else if (link.category === 'page') {
      if (link.subCategory === 'promotion-page') grouped.promotions.push(link);
      else if (link.subCategory === 'parts-page') grouped.parts.push(link);
      else grouped.staticPages.push(link);
    } 
    else {
      grouped.other.push(link);
    }
  });

  return grouped;
};