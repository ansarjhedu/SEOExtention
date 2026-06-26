// components/Header.js

import React from 'react';
import logo from '../assets/logo.png'; // Ensure you have a logo image in the specified path

export default function Header({ scanning, serverOnline, activeTabTitle }) {
  return (
    <header className="sticky top-0 bg-slate-950/90 backdrop-blur-md border-b border-[#1b3a5c] px-4 py-3 flex flex-col gap-1.5 z-10">
      <div className="flex items-center justify-between">
        
        {/* Symmetric Branding Block with MaxOpp X-Factor Logo */}
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-14 rounded bg-slate-900 border border-slate-800 p-0.5 flex items-center justify-center overflow-hidden">
            <img 
              src={logo}
              alt="MaxOpp Marketing" 
              className="h-full w-full object-contain"
            />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xs font-black tracking-widest text-[#f4f5f7] uppercase leading-none">
              MaxOpp aiSEO
            </h1>
            <span className="text-[9px] text-slate-400 font-medium tracking-wider mt-0.5">
              Intelligence Engine v1.0
            </span>
          </div>
        </div>
        
        {/* Connection status badge */}
        <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800/80 px-2 py-1 rounded-md">
          <div className={`h-1.5 w-1.5 rounded-full ${serverOnline ? 'bg-teal-400 animate-pulse' : 'bg-rose-500'}`}></div>
          <span className="text-[8px] uppercase font-bold tracking-widest text-slate-400">
            {serverOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>
    </header>
  );
}