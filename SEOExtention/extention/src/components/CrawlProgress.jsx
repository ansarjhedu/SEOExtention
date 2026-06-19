// components/CrawlProgress.js

import React from 'react';

export default function CrawlProgress({ 
  scanning, 
  crawlMode, 
  backendStatus, 
  crawlProgress, 
  workers, 
  pagesCrawled, 
  queueSize 
}) {
  if (!scanning || crawlMode !== 'deep') return null;

  const totalDiscovered = pagesCrawled + queueSize;

  return (
    <div className="bg-slate-900 border border-slate-800/80 rounded-lg p-3.5 flex flex-col gap-3.5 animate-fade-in shadow-xl shadow-black/20">
      
      {/* Cumulative Metrics Progress Slider */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-300 font-semibold tracking-wide flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            {backendStatus || 'Scanning pages...'}
          </span>
          <span className="text-teal-400 font-extrabold text-sm">{crawlProgress}%</span>
        </div>
        
        {/* Progress Slider */}
        <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800/50">
          <div 
            className="bg-gradient-to-r from-teal-500 via-emerald-500 to-indigo-500 h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${crawlProgress}%` }}
          ></div>
        </div>

        {/* Informational Queue Counts */}
        <div className="flex justify-between items-center mt-1 text-[10px] font-bold text-slate-400 px-0.5 border-b border-slate-800/40 pb-2.5">
          <span>Processed: <span className="text-slate-200">{pagesCrawled}</span> pages</span>
          <span>Scanned: <span className="text-teal-400">{pagesCrawled}</span> / Discovered: <span className="text-indigo-400">{totalDiscovered}</span></span>
        </div>
      </div>

      {/* Crawl Engine Core Status */}
      {workers && workers.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center justify-between">
            <span>Crawl Engine</span>
            <span className="text-teal-500 font-medium">Sequential • Bot-Safe</span>
          </div>
          
          <div className="flex flex-col gap-2">
            {workers.map((worker) => {
              const isActive = worker.status === 'crawling';
              const totalAssigned = worker.processedCount + worker.queueSize;
              const subProgress = totalAssigned > 0 
                ? Math.round((worker.processedCount / totalAssigned) * 100) 
                : 0;
              
              return (
                <div 
                  key={worker.id} 
                  className={`p-2.5 rounded-md border text-left transition-all duration-300 flex flex-col gap-1.5
                    ${isActive 
                      ? 'bg-slate-950/70 border-emerald-500/20 shadow-md shadow-emerald-500/5' 
                      : 'bg-slate-950/20 border-slate-800/40 opacity-50'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">
                      Crawl Engine
                    </span>
                    <span className="relative flex h-1.5 w-1.5">
                      {isActive && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isActive ? 'bg-emerald-500' : 'bg-slate-700'}`}></span>
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[8.5px] font-bold text-slate-400">
                    <span>Scanned: {worker.processedCount}</span>
                    <span>Queue: {worker.queueSize} remaining</span>
                  </div>

                  <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-850/65">
                    <div 
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${subProgress}%` }}
                    ></div>
                  </div>

                  <div className="text-[9.5px] text-slate-300 font-medium truncate break-all h-4 leading-4">
                    {isActive ? worker.currentUrl : 'Standby (Idle)...'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}