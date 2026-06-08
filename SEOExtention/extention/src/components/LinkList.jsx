import React from 'react';

export default function LinkList({ links }) {
  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-[300px] border border-slate-800/80 rounded-lg bg-slate-900/40 p-1 divide-y divide-slate-900/60 scrollbar-thin scrollbar-thumb-slate-800">
      {links.length > 0 ? (
        links.map((link, idx) => {
          const isBroken = link.category === 'broken';

          return (
            <div key={idx} className="p-2 hover:bg-slate-900/80 transition-colors flex flex-col gap-1 rounded">
              <div className="flex justify-between items-start gap-2">
                <span className={`text-[11px] font-semibold line-clamp-1 break-all ${isBroken ? 'text-rose-300' : 'text-slate-200'}`}>
                  {link.text}
                </span>
                
                {/* Dynamically Swap Label for Broken Link badges */}
                {isBroken ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    HTTP {link.statusCode || 404}
                  </span>
                ) : (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0
                    ${link.type === 'internal' 
                      ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20' 
                      : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`}>
                    {link.type}
                  </span>
                )}
              </div>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className={`text-[10px] truncate break-all flex items-center gap-1 transition-colors
                  ${isBroken ? 'text-rose-400/80 hover:text-rose-400' : 'text-slate-400 hover:text-teal-400'}`}
              >
                {link.url}
              </a>
            </div>
          );
        })
      ) : (
        <div className="text-center py-6 text-xs text-slate-500">
          No links match your filters.
        </div>
      )}
    </div>
  );
}