// services/exporter/googleSheets.js

import { google } from 'googleapis';
import path from 'path';

const KEYFILEPATH = path.join(process.cwd(), 'credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const FOLDER_ID = '1Jc5kiuVbhCdICbL9u19J-bW1ArI393A1';
// *** ADD YOUR PERSONAL GMAIL HERE ***
const USER_EMAIL = 'ansarjhedu@gmail.com'; 

export async function createCrawlerReportWorkbook(domainName, mappedData) {
  let spreadsheetId = null;
  let spreadsheetUrl = null;
  let sheetIds = [];

  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive = google.drive({ version: 'v3', auth: authClient });

    // 1. Create Spreadsheet in the Service Account's root drive (Always works)
    console.log(`[Google Sheets] Step 1: Creating workbook...`);
    const resource = {
      properties: { title: `LinkScout Report: ${domainName} - ${new Date().toISOString().split('T')[0]}` },
      sheets: [
        { properties: { title: 'Entity & QA Data' } },
        { properties: { title: 'Vehicle Products' } },
        { properties: { title: 'Inventory Collections' } },
        { properties: { title: 'Brands & Showrooms' } },
        { properties: { title: 'Parts & Service' } },
        { properties: { title: 'Promotions' } },
        { properties: { title: 'Static Pages & Misc' } }
      ]
    };

    const spreadsheet = await sheets.spreadsheets.create({ resource });
    spreadsheetId = spreadsheet.data.spreadsheetId;
    spreadsheetUrl = spreadsheet.data.spreadsheetUrl;
    sheetIds = spreadsheet.data.sheets.map(sheet => sheet.properties.sheetId);
    console.log(`[Google Sheets] Workbook created: ${spreadsheetUrl}`);

    // 2. Share directly with your personal email so you actually own/see the file!
    console.log(`[Google Drive] Step 2: Sharing file with ${USER_EMAIL}...`);
    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        resource: { type: 'user', role: 'writer', emailAddress: USER_EMAIL },
        sendNotificationEmail: false // Keeps your inbox from getting spammed
      });
    } catch (shareErr) {
      console.warn(`[Google Drive] Could not share file directly: ${shareErr.message}`);
    }

    // 3. Attempt to move it to your 'maxxopp crawls' folder
    console.log(`[Google Drive] Step 3: Attempting to move to folder...`);
    try {
      const file = await drive.files.get({ fileId: spreadsheetId, fields: 'parents' });
      const previousParents = file.data.parents ? file.data.parents.join(',') : '';
      await drive.files.update({
        fileId: spreadsheetId,
        addParents: FOLDER_ID,
        removeParents: previousParents,
        fields: 'id, parents'
      });
      console.log(`[Google Drive] Successfully moved to folder!`);
    } catch (driveErr) {
      console.warn(`[Google Drive] Folder move skipped (Personal account restriction). Check 'Shared with me'.`);
    }

    // 4. Write Data
    console.log(`[Google Sheets] Step 4: Writing data to tabs...`);
    try {
      await writeDataToTabs(sheets, spreadsheetId, mappedData);
    } catch (dataErr) {
      console.error(`[Google Sheets] FATAL: Failed to write data: ${dataErr.message}`);
      throw dataErr; 
    }

    // 5. Apply Styles
    console.log(`[Google Sheets] Step 5: Applying colors and formatting...`);
    try {
      await applyStylingAndColors(sheets, spreadsheetId, sheetIds, mappedData);
    } catch (styleErr) {
      console.warn(`[Google Sheets] WARNING: Styling failed, but data was saved. Error: ${styleErr.message}`);
    }

    return spreadsheetUrl;

  } catch (error) {
    console.error(`[Google Sheets] Process failed completely: ${error.message}`);
    throw error;
  }
}

async function writeDataToTabs(sheets, spreadsheetId, mappedData) {
  const sanitizeAndPad = (grid) => {
    if (!grid || grid.length === 0) return [['No Data Found']];
    const maxCols = Math.max(...grid.map(row => row.length));
    return grid.map(row => {
      const paddedRow = [...row];
      while (paddedRow.length < maxCols) paddedRow.push(''); 
      return paddedRow.map(cell => String(cell || '')); 
    });
  };

  const data = [
    { range: "'Entity & QA Data'!A1", values: sanitizeAndPad(mappedData.entityData) },
    { range: "'Vehicle Products'!A1", values: sanitizeAndPad(mappedData.vehicleProducts) },
    { range: "'Inventory Collections'!A1", values: sanitizeAndPad(mappedData.inventoryCollections) },
    { range: "'Brands & Showrooms'!A1", values: sanitizeAndPad(mappedData.brandsAndShowrooms) },
    { range: "'Parts & Service'!A1", values: sanitizeAndPad(mappedData.partsAndService) },
    { range: "'Promotions'!A1", values: sanitizeAndPad(mappedData.promotions) },
    { range: "'Static Pages & Misc'!A1", values: sanitizeAndPad(mappedData.staticPages) }
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: { valueInputOption: 'USER_ENTERED', data }
  });
}

async function applyStylingAndColors(sheets, spreadsheetId, sheetIds, mappedData) {
  const requests = [];
  const qaDataSheetId = sheetIds[0];

  const createColorRule = (text, rgbBg, rgbTxt) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: qaDataSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 }], 
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: text }] },
          format: { backgroundColor: rgbBg, textFormat: { foregroundColor: rgbTxt, bold: true } }
        }
      }, index: 0
    }
  });

  requests.push(createColorRule('VERIFIED', { red: 0.85, green: 0.92, blue: 0.83 }, { red: 0.15, green: 0.48, blue: 0.18 }));
  requests.push(createColorRule('MISSING', { red: 0.98, green: 0.85, blue: 0.85 }, { red: 0.65, green: 0.12, blue: 0.15 }));
  requests.push(createColorRule('INFERRED', { red: 1.0, green: 0.95, blue: 0.80 }, { red: 0.60, green: 0.40, blue: 0.0 }));
  requests.push(createColorRule('DEALER', { red: 0.90, green: 0.90, blue: 0.90 }, { red: 0.30, green: 0.30, blue: 0.30 }));

  const dataLengths = [
    mappedData.entityData.length,
    mappedData.vehicleProducts.length,
    mappedData.inventoryCollections.length,
    mappedData.brandsAndShowrooms.length,
    mappedData.partsAndService.length,
    mappedData.promotions.length,
    mappedData.staticPages.length
  ];

  for (let i = 0; i < sheetIds.length; i++) {
    const currentSheetId = sheetIds[i];
    const rowCount = Math.max(dataLengths[i], 2); 

    requests.push({
      repeatCell: {
        range: { sheetId: currentSheetId, startRowIndex: 0, endRowIndex: 1 }, 
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.1, green: 0.2, blue: 0.4 }, 
            textFormat: { foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 }, bold: true },
            horizontalAlignment: 'CENTER'
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
      }
    });

    requests.push({
      addBanding: {
        bandedRange: {
          range: { sheetId: currentSheetId, startRowIndex: 0, endRowIndex: rowCount }, 
          rowProperties: {
            headerColor: { red: 0.1, green: 0.2, blue: 0.4 }, 
            firstBandColor: { red: 1.0, green: 1.0, blue: 1.0 },
            secondBandColor: { red: 0.95, green: 0.95, blue: 0.97 }
          }
        }
      }
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests }
  });
}