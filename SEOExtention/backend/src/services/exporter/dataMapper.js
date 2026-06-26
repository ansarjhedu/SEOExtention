// services/exporter/dataMapper.js

/**
 * Transforms the crawler session data into 2D Arrays for Google Sheets.
 */
export function mapCrawlerDataForSheets(session) {
  const { dealershipProfile, discoveredLinks } = session;

  // Helper to ensure safe array returns
  const filterLinks = (cat, subCat) => discoveredLinks.filter(l => l.category === cat && l.subCategory === subCat);

  // --- TAB 1: Entity & QA Data (Strict formatting for prompt) ---
  const entityData = [
    ['Field', 'Value', 'Tier', 'Evidence'] // Header
  ];

  const pushEntity = (field, value, fallbackEvidence = '') => {
    if (value && value.trim() !== '') {
      entityData.push([field, value, 'VERIFIED', fallbackEvidence || 'Extracted via LD-JSON / DOM']);
    } else {
      entityData.push([field, '', 'MISSING', '']);
    }
  };

  pushEntity('Dealership Name', dealershipProfile.dealershipName);
  pushEntity('Legal Corporate Name', dealershipProfile.legalCorporateName);
  pushEntity('Telephone', dealershipProfile.telephoneMainLine);
  pushEntity('Address', `${dealershipProfile.streetAddress}, ${dealershipProfile.city}, ${dealershipProfile.state} ${dealershipProfile.zipCode}`);
  pushEntity('Google Business URL', dealershipProfile.googleBusinessUrl);

  // Check specific Required URLs
  const findUrlByKeyword = (keyword) => discoveredLinks.find(l => l.url.includes(keyword))?.url || '';
  pushEntity('Service Page', findUrlByKeyword('service'), findUrlByKeyword('service'));
  pushEntity('Parts Page', findUrlByKeyword('parts'), findUrlByKeyword('parts'));
  pushEntity('Finance Page', findUrlByKeyword('finance'), findUrlByKeyword('finance'));

  // --- TAB 2: Vehicle Products ---
  const vehicleProducts = [['URL', 'Anchor Text', 'Condition', 'Vehicle Type', 'Brand', 'Model', 'Year', 'Price', 'Status']];
  discoveredLinks.filter(l => l.category === 'product').forEach(link => {
    vehicleProducts.push([
      link.url, link.text, link.subCategory.replace('-product', ''), link.vehicleType, 
      link.brandName, link.modelName, link.year, link.price, link.verificationStatus
    ]);
  });

  // --- TAB 3: Inventory Collections ---
  const inventoryCollections = [['URL', 'Anchor Text', 'Sub Category']];
  discoveredLinks.filter(l => l.category === 'inventory').forEach(link => {
    inventoryCollections.push([link.url, link.text, link.subCategory]);
  });

  // --- TAB 4: Brands & Showrooms ---
  const brandsAndShowrooms = [['URL', 'Anchor Text', 'Sub Category', 'Brand Name Identified']];
  discoveredLinks.filter(l => l.category === 'collection').forEach(link => {
    brandsAndShowrooms.push([link.url, link.text, link.subCategory, link.brandName]);
  });

  // --- TAB 5: Parts & Service ---
  const partsAndService = [['URL', 'Anchor Text', 'Sub Category']];
  filterLinks('page', 'parts-page').forEach(link => partsAndService.push([link.url, link.text, link.subCategory]));

  // --- TAB 6: Promotions ---
  const promotions = [['URL', 'Anchor Text']];
  filterLinks('page', 'promotion-page').forEach(link => promotions.push([link.url, link.text]));

  // --- TAB 7: Static Pages & Misc ---
  const staticPages = [['URL', 'Anchor Text', 'Category']];
  discoveredLinks.filter(l => l.category === 'other' || (l.category === 'page' && l.subCategory === 'static-page')).forEach(link => {
    staticPages.push([link.url, link.text, link.category]);
  });

  return {
    entityData,
    vehicleProducts,
    inventoryCollections,
    brandsAndShowrooms,
    partsAndService,
    promotions,
    staticPages
  };
}