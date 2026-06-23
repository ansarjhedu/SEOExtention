import React from 'react';

export default function Header({ scanning, serverOnline, activeTabTitle }) {
  return (
    <header className="sticky top-0 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3 flex flex-col gap-1.5 z-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${scanning ? 'bg-amber-400' : 'bg-teal-400'} opacity-75`}></span>
            <span className={`relative inline-flex rounded-full h-3 w-3 ${scanning ? 'bg-amber-500' : 'bg-teal-500'}`}></span>
          </span>
          <h1 className="text-md font-bold tracking-wider text-slate-200">
          MaxOpp aiSEO crawler <span className="text-xs font-normal text-slate-400">v1.0</span>
          </h1>
        </div>
        
        {/* Connection status badge */}
        <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800/80 px-2 py-1 rounded-md">
          <div className={`h-1.5 w-1.5 rounded-full ${serverOnline ? 'bg-teal-400 animate-pulse' : 'bg-rose-500'}`}></div>
          <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">
            {serverOnline ? 'Server Online' : 'Server Offline'}
          </span>
        </div>
      </div>
      
      {/* <div className="flex items-center justify-between text-[10px] text-slate-500 px-0.5">
        <span>By Ansar Jhedu</span>
        <span className="truncate max-w-[150px]">{activeTabTitle || 'Checking page...'}</span>
      </div> */}
    </header>
  );
}