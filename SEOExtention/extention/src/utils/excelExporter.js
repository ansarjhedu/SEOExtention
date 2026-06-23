// src/utils/excelExporter.js

import * as XLSX from 'xlsx';

export const exportCrawlDataToExcel = (groupedData, domainName, profileData) => {
  if (!groupedData) return;

  const wb = XLSX.utils.book_new();

  // 1. DEALERSHIP PROFILE SHEET
  const profileRows = [{
    'Dealership Name': profileData?.dealershipName || 'N/A',
    'Legal Corporate Name': profileData?.legalCorporateName || 'N/A',
    'DBA Alternate Name': profileData?.dbaAlternateName || 'N/A',
    'Street Address': profileData?.streetAddress || 'N/A',
    'City': profileData?.city || 'N/A',
    'State': profileData?.state || 'N/A',
    'Zip Code': profileData?.zipCode || 'N/A',
    'Telephone Main Line': profileData?.telephoneMainLine || 'N/A',
    'Sales Hours Specifications': profileData?.salesHours || 'N/A',
    'Service Hours Specifications': profileData?.serviceHours || 'N/A',
    'GPS Latitude Coordinate': profileData?.latitude || 'N/A',
    'GPS Longitude Coordinate': profileData?.longitude || 'N/A',
    'Google Business URL': profileData?.googleBusinessUrl || 'N/A',
    'Finance Lending Partners': profileData?.lendingPartners?.join(', ') || 'N/A',
    'Finance Programs Offered': profileData?.programsOffered?.join(', ') || 'N/A',
    'Service Warranty Claims': profileData?.claims?.join(', ') || 'N/A',
    'Service Rates/Tiers': profileData?.tiers?.join(', ') || 'N/A'
  }];

  const wsProfile = XLSX.utils.json_to_sheet(profileRows);
  XLSX.utils.book_append_sheet(wb, wsProfile, 'Dealership Profile');

  // 2. INVENTORY SHEET
  const inventoryRows = [];
  const addInventoryMainLinks = (mainLinks, conditionLabel) => {
    (mainLinks || []).forEach(link => {
      inventoryRows.push({
        'URL': link.url || '',
        'Anchor Text': link.text || '',
        'Condition': conditionLabel,
        'Brand Tag': link.brandName || 'N/A'
      });
    });
  };

  addInventoryMainLinks(groupedData?.inventory?.newInventory?.mainLinks, 'New');
  addInventoryMainLinks(groupedData?.inventory?.usedInventory?.mainLinks, 'Used');
  addInventoryMainLinks(groupedData?.inventory?.generalInventory?.mainLinks, 'General');

  if (inventoryRows.length > 0) {
    const wsInv = XLSX.utils.json_to_sheet(inventoryRows);
    XLSX.utils.book_append_sheet(wb, wsInv, 'Inventory');
  }

  // 3. PRODUCTS SHEET (Vehicles)
  const productRows = [];
  const addProductVehicles = (vehicles, conditionLabel) => {
    (vehicles || []).forEach(link => {
      productRows.push({
        'URL': link.url || '',
        'Anchor Text': link.text || '',
        'Condition': conditionLabel,
        'Year': link.year || 'N/A',
        'Brand Name': link.brandName || 'N/A',
        'Model Name': link.modelName || 'N/A',
        'Vehicle Type': link.vehicleType || 'Vehicle',
        'Price': link.price || 'Missing',
        'Verification Status': link.verificationStatus ? link.verificationStatus.toUpperCase() : 'MISSING'
      });
    });
  };

  addProductVehicles(groupedData?.inventory?.newInventory?.vehicles, 'New');
  addProductVehicles(groupedData?.inventory?.usedInventory?.vehicles, 'Used');
  addProductVehicles(groupedData?.inventory?.generalInventory?.vehicles, 'General');

  if (productRows.length > 0) {
    const wsProd = XLSX.utils.json_to_sheet(productRows);
    XLSX.utils.book_append_sheet(wb, wsProd, 'Products');
  }

  // 4. BRANDS & CATEGORIES SHEET
  const brandRows = [];
  (groupedData?.collections?.brandDirectories || []).forEach(link => {
    brandRows.push({
      'URL': link.url || '',
      'Anchor Text': link.text || '',
      'Collection Type': 'Brand Dropdown Link'
    });
  });
  (groupedData?.collections?.brandModelLists || []).forEach(link => {
    brandRows.push({
      'URL': link.url || '',
      'Anchor Text': link.text || '',
      'Collection Type': 'Manufacturer Model List'
    });
  });
  (groupedData?.collections?.modelCatalogFilters || []).forEach(link => {
    brandRows.push({
      'URL': link.url || '',
      'Anchor Text': link.text || '',
      'Collection Type': 'Category/Type Filter'
    });
  });

  if (brandRows.length > 0) {
    const wsBrand = XLSX.utils.json_to_sheet(brandRows);
    XLSX.utils.book_append_sheet(wb, wsBrand, 'Brands & Categories');
  }

  // 5. PROMOTIONS SHEET
  const promotionRows = [];
  (groupedData?.promotions || []).forEach(link => {
    promotionRows.push({
      'URL': link.url || '',
      'Anchor Text': link.text || '',
      'Page Category': 'Promotion Landing Page'
    });
  });

  if (promotionRows.length > 0) {
    const wsPromo = XLSX.utils.json_to_sheet(promotionRows);
    XLSX.utils.book_append_sheet(wb, wsPromo, 'Promotions');
  }

  // 6. PARTS SHEET
  const partsRows = [];
  (groupedData?.parts || []).forEach(link => {
    partsRows.push({
      'URL': link.url || '',
      'Anchor Text': link.text || '',
      'Page Category': 'Parts Request Page'
    });
  });

  if (partsRows.length > 0) {
    const wsParts = XLSX.utils.json_to_sheet(partsRows);
    XLSX.utils.book_append_sheet(wb, wsParts, 'Parts');
  }

  // 7. STATIC & MISC SHEET
  const staticRows = [];
  (groupedData?.staticPages || []).forEach(link => {
    staticRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Category': 'Static Page' });
  });
  (groupedData?.other || []).forEach(link => {
    staticRows.push({ 'URL': link.url || '', 'Anchor Text': link.text || '', 'Category': 'Other' });
  });

  if (staticRows.length > 0) {
    const wsStatic = XLSX.utils.json_to_sheet(staticRows);
    XLSX.utils.book_append_sheet(wb, wsStatic, 'Static & Misc');
  }

  // Save Workbook
  XLSX.writeFile(wb, `MAXOP_${domainName}_Audit_${Date.now()}.xlsx`);
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
      if (link.subCategory === 'brand-directory') {
        grouped.collections.brandDirectories.push(link);
      } else if (link.subCategory === 'brand-model-list') {
        grouped.collections.brandModelLists.push(link);
      } else {
        grouped.collections.modelCatalogFilters.push(link);
      }
    } 
    else if (link.category === 'product') {
      grouped.inventory.newInventory.vehicles.push(link);
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
  });

  return grouped;
};