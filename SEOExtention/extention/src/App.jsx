// src/App.js

import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

import Header from './components/Header';
import CrawlProgress from './components/CrawlProgress';
import SummaryWidgets from './components/SummaryWidgets';
import LinkList from './components/LinkList';
import EmptyState from './components/EmptyState';

import { 
  exportCrawlDataToExcel, 
  constructGroupedDataFromFlatList 
} from './utils/excelExporter';

function App() {
  const [links, setLinks] = useState([]);
  const [filter, setFilter] = useState('all'); 
  const [searchTerm, setSearchTerm] = useState('');
  
  const [scanning, setScanning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const [activeTab, setActiveTab] = useState({ url: '', title: '', id: null });
  const [scannedUrl, setScannedUrl] = useState('');

  const [serverOnline, setServerOnline] = useState(false);
  const [crawlMode, setCrawlMode] = useState('quick'); 
  const [crawlProgress, setCrawlProgress] = useState(0);
  const [backendStatus, setBackendStatus] = useState('');
  
  const [pagesCrawled, setPagesCrawled] = useState(0);
  const [queueSize, setQueueSize] = useState(0);
  const [groupedData, setGroupedData] = useState(null);
  
  // Holds the live tracking record for real-time audit reporting
  const [dealershipProfile, setDealershipProfile] = useState(null);

  const socketRef = useRef(null);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    //  socketRef.current = io('http://localhost:5000', {
    socketRef.current = io('https://seoextention.onrender.com', {

      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity
    });

    socketRef.current.on('connect', () => {
      setServerOnline(true);
      const currentTab = activeTabRef.current;
      if (currentTab.url && !currentTab.url.startsWith('chrome://')) {
        socketRef.current.emit('check_active_crawl', { targetUrl: currentTab.url });
      }
    });

    socketRef.current.on('disconnect', () => {
      setServerOnline(false);
    });

    socketRef.current.on('crawl_data_grouped', (data) => {
      if (!data) return;
      
      const { grouped, dealershipProfile: profile } = data;
      setGroupedData(grouped);
      setDealershipProfile(profile);

      if (grouped) {
        const flatLinks = [
          ...(grouped?.collections?.brandDirectories || []),
          ...(grouped?.collections?.brandModelLists || []),
          ...(grouped?.collections?.modelCatalogFilters || []),
          ...(grouped?.inventory?.newInventory?.mainLinks || []),
          ...(grouped?.inventory?.newInventory?.vehicles || []),
          ...(grouped?.inventory?.usedInventory?.mainLinks || []),
          ...(grouped?.inventory?.usedInventory?.vehicles || []),
          ...(grouped?.inventory?.generalInventory?.mainLinks || []),
          ...(grouped?.inventory?.generalInventory?.vehicles || []),
          ...(grouped?.promotions || []), 
          ...(grouped?.parts || []),      
          ...(grouped?.staticPages || []),
          ...(grouped?.other || [])
        ];
        setLinks(flatLinks);
      }
    });

    socketRef.current.on('crawl_status_update', (data) => {
      setIsPaused(data.isPaused);
      if (data.isTerminated) {
        setScanning(false);
        setIsPaused(false);
      }
    });

    socketRef.current.on('crawl_status', (data) => {
      setScanning(data.status === 'processing');
      setBackendStatus(data.message);
      setCrawlProgress(data.progress);
      
      if (data.pagesCrawled !== undefined) setPagesCrawled(data.pagesCrawled);
      if (data.queueSize !== undefined) setQueueSize(data.queueSize);

      if (data.status === 'completed' || data.status === 'terminated') {
        setBackendStatus(data.message);
        setScanning(false);
        setIsPaused(false);
      }
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    async function initActiveTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        setActiveTab({ url: tab.url || '', title: tab.title || '', id: tab.id });
      }
    }
    initActiveTab();

    const handleActivated = (activeInfo) => {
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab) {
          const tabUrl = tab.url || '';
          setActiveTab({ url: tabUrl, title: tab.title || '', id: tab.id });
          if (socketRef.current && socketRef.current.connected && tabUrl && !tabUrl.startsWith('chrome://')) {
            socketRef.current.emit('check_active_crawl', { targetUrl: tabUrl });
          }
        }
      });
    };

    const handleUpdated = (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.active) {
        const tabUrl = tab.url || '';
        setActiveTab({ url: tabUrl, title: tab.title || '', id: tab.id });
        if (socketRef.current && socketRef.current.connected && tabUrl && !tabUrl.startsWith('chrome://')) {
          socketRef.current.emit('check_active_crawl', { targetUrl: tabUrl });
        }
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, []);

  const isTabLoading = !activeTab.url;
  const isSystemPage = activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('about:'));

  const handleScan = async () => {
    if (isSystemPage || isTabLoading) return;
    setScanning(true);
    setIsPaused(false);
    setBackendStatus('');
    setCrawlProgress(0);
    setLinks([]);
    setGroupedData(null);
    setDealershipProfile(null);
    setScannedUrl(activeTab.url);
    setPagesCrawled(0);
    setQueueSize(1);

    if (crawlMode === 'quick') {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content.js']
        });

        chrome.tabs.sendMessage(activeTab.id, { action: "extract_links" }, (response) => {
          if (chrome.runtime.lastError) {
            alert("Connection error. Refresh tab and scan again.");
            setScanning(false);
            return;
          }

          if (response && response.status === "success") {
            const processedLocal = response.data
              .filter(item => item.type === 'internal') 
              .map(item => {
                const lowerUrl = item.url.toLowerCase();
                let category = 'other';
                let subCategory = '';
                
                if (lowerUrl.includes('/products/')) category = 'product';
                else if (lowerUrl.includes('/collections/')) category = 'collection';
                else if (lowerUrl.includes('/inventory') || lowerUrl.includes('/search')) {
                  category = 'inventory';
                  subCategory = 'general-inventory';
                } else {
                  category = 'page';
                }
                return { ...item, category, subCategory, type: 'internal' };
              });
            setLinks(processedLocal);
          } else {
            alert("No links discovered.");
          }
          setScanning(false);
        });
      } catch (error) {
        alert("Execution exception.");
        setScanning(false);
      }
    } else {
      if (!serverOnline) {
        alert("Backend server is offline.");
        setScanning(false);
        return;
      }
      socketRef.current.emit('start_deep_crawl', { targetUrl: activeTab.url });
    }
  };

  const handlePause = () => {
    if (socketRef.current) socketRef.current.emit('pause_crawl', { targetUrl: activeTab.url });
  };

  const handleResume = () => {
    if (socketRef.current) socketRef.current.emit('resume_crawl', { targetUrl: activeTab.url });
  };

  const handleTerminate = () => {
    if (socketRef.current) socketRef.current.emit('terminate_crawl', { targetUrl: activeTab.url });
  };

  const filteredLinks = links.filter(link => {
    const matchesCategory = 
      filter === 'all' || 
      (filter === 'promotions' && link.category === 'page' && link.subCategory === 'promotion-page') ||
      (filter === 'parts' && link.category === 'page' && link.subCategory === 'parts-page') ||
      (filter === 'page' && link.category === 'page' && link.subCategory !== 'promotion-page' && link.subCategory !== 'parts-page') ||
      (link.category === filter && filter !== 'promotions' && filter !== 'parts' && filter !== 'page');
      
    const matchesSearch = 
      link.url.toLowerCase().includes(searchTerm.toLowerCase()) || 
      link.text.toLowerCase().includes(searchTerm.toLowerCase());
      
    return matchesCategory && matchesSearch;
  });

  const handleCopyAll = () => {
    if (filteredLinks.length === 0) return;
    const listString = filteredLinks.map(l => l.url).join('\n');
    navigator.clipboard.writeText(listString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCSV = () => {
    if (filteredLinks.length === 0) return;
    let csvContent = "data:text/csv;charset=utf-8,URL,Anchor Text,Category,Type,Brand,Model,Price\n";
    filteredLinks.forEach(link => {
      const cleanText = link.text.replace(/"/g, '""');
      csvContent += `"${link.url}","${cleanText}","${link.category}","${link.type}","${link.brandName || ''}","${link.modelName || ''}","${link.price || ''}"\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", encodedUri);
    linkElement.setAttribute("download", `extracted_${filter}_links_${Date.now()}.csv`);
    document.body.appendChild(linkElement);
    linkElement.click();
    document.body.removeChild(linkElement);
  };

  const handleExportXLSX = () => {
    if (links.length === 0) return;
    let exportPayload = groupedData;
    if (!exportPayload) {
      exportPayload = constructGroupedDataFromFlatList(links);
    }
    const cleanDomain = activeTab.url 
      ? activeTab.url.replace(/https?:\/\/(www\.)?/, '').split('/')[0] 
      : 'export';

    exportCrawlDataToExcel(exportPayload, cleanDomain, dealershipProfile);
  };

  const showNewTabBanner = links.length > 0 && scannedUrl !== activeTab.url && !isSystemPage;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-teal-500 selection:text-slate-950">
      
      <Header 
        scanning={scanning} 
        serverOnline={serverOnline} 
        activeTabTitle={activeTab.title} 
      />

      {showNewTabBanner && (
        <div className="bg-indigo-600/10 border-b border-indigo-500/20 px-4 py-2.5 flex items-center justify-between gap-2 text-xs">
          <span className="text-indigo-300">Viewing scan for another page.</span>
          <button 
            onClick={handleScan}
            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded text-[10px] cursor-pointer transition-all active:scale-95"
          >
            Scan Tab
          </button>
        </div>
      )}

      <main className="flex-1 flex flex-col p-4 gap-4">
        
        {/* Run Mode Switcher - Styled with Corporate Accent */}
        {!isSystemPage && !scanning && !isTabLoading && (
          <div className="flex rounded-md bg-slate-900 p-0.5 border border-[#1b3a5c]">
            <button
              onClick={() => setCrawlMode('quick')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-all cursor-pointer
                ${crawlMode === 'quick' ? 'bg-[#1b3a5c] text-[#f4f5f7]' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Quick On-Page
            </button>
            <button
              onClick={() => setCrawlMode('deep')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-all cursor-pointer flex items-center justify-center gap-1
                ${crawlMode === 'deep' ? 'bg-[#1b3a5c] text-[#f4f5f7]' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Deep Server-Side
            </button>
          </div>
        )}

        {/* Stable Scan Controls Grid */}
        {isTabLoading ? (
          <button disabled className="w-full py-3 px-4 rounded-lg font-semibold text-sm bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed">
            Locating Active Browser Tab...
          </button>
        ) : isSystemPage ? (
          <div className="w-full py-3 px-4 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 text-center text-xs font-semibold">
            System Pages Cannot Be Scanned
          </div>
        ) : (
          !scanning ? (
            <button
              onClick={handleScan}
              className="w-full py-3 px-4 rounded-lg font-bold text-sm transition-all bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/10 cursor-pointer active:scale-98"
            >
              {crawlMode === 'quick' ? 'Scan Current Page' : 'Start Deep Server Crawl'}
            </button>
          ) : (
            <div className="flex gap-2 bg-slate-900 p-2 border border-[#1b3a5c] rounded-lg animate-fade-in">
              {crawlMode === 'deep' && (
                <>
                  {isPaused ? (
                    <button
                      onClick={handleResume}
                      className="flex-1 py-2 bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/30 text-emerald-400 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      ▶ Resume
                    </button>
                  ) : (
                    <button
                      onClick={handlePause}
                      className="flex-1 py-2 bg-amber-600/20 border border-amber-500/30 hover:bg-amber-600/30 text-amber-400 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      ⏸ Pause
                    </button>
                  )}
                </>
              )}
              
              <button
                onClick={handleTerminate}
                className="flex-1 py-2 bg-rose-600/20 border border-rose-500/30 hover:bg-rose-600/30 text-rose-400 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                ⏹ Stop Scan
              </button>
            </div>
          )
        )}

        {/* Live Data Audit Dashboard Container */}
        <CrawlProgress 
          scanning={scanning} 
          crawlMode={crawlMode} 
          backendStatus={backendStatus} 
          crawlProgress={crawlProgress} 
          pagesCrawled={pagesCrawled}
          queueSize={queueSize}
          dealershipProfile={dealershipProfile} // Injects live field updates
        />

        {/* Links Display Panel */}
        {links.length > 0 && (
          <div className="flex flex-col gap-4 animate-fade-in">
            
            <SummaryWidgets links={links} />

            <div className="flex flex-col gap-2">
              <input
                type="text"
                placeholder="Filter results..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
              
              <div className="flex rounded-md bg-slate-900 p-0.5 border border-slate-800 overflow-x-auto scrollbar-none">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'inventory', label: 'Inventory' },
                  { key: 'collection', label: 'Brands' },
                  { key: 'product', label: 'Products' },
                  { key: 'promotions', label: 'Promotions' }, 
                  { key: 'parts', label: 'Parts' },           
                  { key: 'page', label: 'Pages' },
                  { key: 'other', label: 'Other' }
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setFilter(tab.key)}
                    className={`flex-1 py-1.5 px-2.5 text-[9px] font-bold uppercase tracking-wider rounded-sm transition-all whitespace-nowrap cursor-pointer
                      ${filter === tab.key ? 'bg-slate-850 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button onClick={handleCopyAll} className="flex-1 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 text-slate-300 transition-all cursor-pointer active:scale-95">
                  {copied ? <span className="text-teal-400">✓ Copied!</span> : 'Copy List'}
                </button>
                <button onClick={handleDownloadCSV} className="flex-1 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 text-slate-300 transition-all cursor-pointer active:scale-95">
                  Download CSV
                </button>
              </div>
              
              <button 
                onClick={handleExportXLSX}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/10 cursor-pointer transition-all active:scale-98"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export Tabbed Excel File
              </button>
            </div>

            <LinkList links={filteredLinks} />
          </div>
        )}

        {links.length === 0 && !scanning && (
          <EmptyState isSystemPage={isSystemPage} />
        )}
      </main>
    </div>
  );
}

export default App;