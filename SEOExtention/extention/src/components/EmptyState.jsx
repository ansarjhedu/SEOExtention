import React from 'react';

export default function EmptyState({ isSystemPage }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
      <div className="bg-slate-900 border border-slate-800 h-12 w-12 rounded-full flex items-center justify-center text-slate-400 mb-3 shadow-lg animate-pulse">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </div>
      <p className="text-slate-300 text-sm font-semibold mb-1">
        {isSystemPage ? 'System Page Detected' : 'No Scanned Links'}
      </p>
      <p className="text-slate-500 text-xs max-w-xs leading-relaxed">
        {isSystemPage 
          ? 'LinkScout is currently idle. Switch tabs to an active website or collection to execute a scan.' 
          : 'Choose an extraction mode above and click scan to instantly parse client-side links.'}
      </p>
    </div>
  );
}