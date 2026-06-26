import { google } from 'googleapis';
import path from 'path';

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(process.cwd(), 'credentials.json'),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets', 
    'https://www.googleapis.com/auth/drive'
  ],
});

// Your personal 'maxxopp crawls' folder
const FOLDER_ID = '1Jc5kiuVbhCdICbL9u19J-bW1ArI393A1'; 

async function runTest() {
  try {
    console.log("Authenticating with Google...");
    const client = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: client });
    
    console.log(`Attempting to create file directly in folder: ${FOLDER_ID}...`);
    const res = await drive.files.create({
       resource: { 
         name: 'API Connection Test', 
         mimeType: 'application/vnd.google-apps.spreadsheet',
         parents: [FOLDER_ID] // <--- Bypasses the Service Account quota
       },
       fields: 'id, webViewLink',
       supportsAllDrives: true
    });
    
    console.log("✅ SUCCESS! File created in your folder. Link:", res.data.webViewLink);
  } catch (error) {
    console.error("❌ GOOGLE API FAILED:", error.message);
  }
}

runTest();