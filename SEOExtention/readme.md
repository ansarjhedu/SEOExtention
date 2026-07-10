# Dealership Data Extraction Engine

Welcome to your automated Dealership Data Extraction Engine. Because powersports websites use Web Application Firewalls (WAF) to block automated systems, this tool is designed to run securely and locally on your computer. It utilizes a specialized Chrome Extension Native Bridge (`RevFetch`) to safely bypass these firewalls using your live browser session.

---

## 📁 Project Structure

* **`/extension`** — The visual dashboard interface (Chrome Extension).
* **`/backend`** — The data processing and Excel-generation engine.
* **`/revfetch`** — The Windows native bridge that connects Chrome to your computer.

---

## 🛠️ Part 1: One-Time Setup (Takes 2 Minutes)

You only need to do this the very first time you download the software to link the engine to your computer.

### Step 1: Install the Windows Native Bridge
Chrome requires permission to talk to the local background data engine.
1. Open the **`revfetch`** folder.
2. Double-click the file named **`install.bat`** (or just `install`).
3. A black terminal window will appear, link the system to your PC, and say **"SUCCESS!"**.
4. Press any key to close that window.

### Step 2: Add the Interface to Google Chrome
1. Open Google Chrome and type `chrome://extensions/` into the top search bar.
2. In the top-right corner, turn the **Developer mode** toggle to **ON**.
3. In the top-left corner, click the **Load unpacked** button.
4. Browse into this project's unzipped folder, select the **`extension`** folder, and click **Select Folder**.
5. The Crawler icon will now appear in your Chrome extensions menu (the puzzle piece icon at the top right of your browser). *Tip: Pin it to your toolbar for easy access!*

---

## 🏎️ Part 2: How to Run a Crawl

Every time you want to use the tool, you must start the background processing engine.

### Step 1: Start the Background Engine
1. Go to the main project folder.
2. Double-click **`Start_Engine.bat`**.
3. A terminal window will open, install any needed updates, and say *"Starting Local Server..."*

> ⚠️ **IMPORTANT:** Keep this black window open in the background while you work! If you close it, the dashboard will lose its connection to the data engine.

### Step 2: Start Auditing
1. Open a new tab in Google Chrome and navigate to the dealership website you want to audit (e.g., `https://www.exampledealership.com`). 
2. Let the dealership page load completely.
3. Click the **Crawler Extension icon** in your Chrome toolbar to open the Dashboard interface.
4. Click **Start Scan**.
5. Watch the progress in the extension interface. When the crawl reaches 100%, you can instantly export your comprehensive Excel workbook.

### 🛑 Shutting Down
When you are completely finished working for the day, simply close the black `Start_Engine.bat` terminal window to safely shut down the backend system.