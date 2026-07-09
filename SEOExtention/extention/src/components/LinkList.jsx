// components/LinkList.js

import React from 'react';

export default function LinkList({ links }) {
  // Helper to format the category/subCategory names cleanly
  const formatCategoryName = (cat, subCat) => {
    if (cat === 'dead_link') return '404 Error';
    if (cat === 'blog') return 'Blog Article';
    if (subCat === 'parts-page' || subCat === 'parts-main' || cat === 'parts') return 'Parts'; // 🚨 FIXED
    if (subCat === 'promotion-page') return 'Promotion';
    if (subCat) {
      return subCat.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
    return cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : 'Link';
  };

  // Helper to assign a color theme based on the root category
  const getBadgeStyle = (category, subCategory) => {
    if (subCategory === 'parts-page' || subCategory === 'parts-main' || category === 'parts') return 'bg-rose-500/10 text-rose-400 border border-rose-500/20'; // 🚨 FIXED
    if (subCategory === 'promotion-page') return 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20';
    if (subCategory === 'service-page') return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
    
    switch (category) {
      case 'product': return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      case 'inventory': return 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
      case 'collection': return 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
      case 'blog': return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
      case 'dead_link': return 'bg-red-500/10 text-red-500 border border-red-500/20';
      case 'page': return 'bg-slate-700/30 text-slate-300 border border-slate-600/30';
      default: return 'bg-teal-500/10 text-teal-400 border border-teal-500/20';
    }
  };

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-[300px] border border-slate-800/80 rounded-lg bg-slate-900/40 p-1 divide-y divide-slate-900/60 scrollbar-thin scrollbar-thumb-slate-800">
      {links.length > 0 ? (
        links.map((link, idx) => {
          const displayCategory = formatCategoryName(link.category, link.subCategory);
          const badgeStyle = getBadgeStyle(link.category, link.subCategory);

          return (
            <div key={idx} className="p-2 hover:bg-slate-900/80 transition-colors flex flex-col gap-1 rounded">
              <div className="flex justify-between items-start gap-2">
                <span className="text-[11px] font-semibold line-clamp-1 break-all text-slate-200">
                  {link.text}
                </span>
                
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 ${badgeStyle}`}>
                  {displayCategory}
                </span>
              </div>

              {(link.brandName || link.vehicleType || link.price) && (
                <div className="flex flex-wrap gap-1 mt-0.5 mb-1">
                  {link.year && (
                    <span className="text-[8.5px] bg-slate-950 text-slate-400 px-1.5 py-0.5 rounded border border-slate-800/50">
                      {link.year}
                    </span>
                  )}
                  {link.brandName && (
                    <span className="text-[8.5px] bg-slate-950 text-teal-400 px-1.5 py-0.5 rounded font-bold border border-slate-800/50">
                      {link.brandName}
                    </span>
                  )}
                  {link.modelName && (
                    <span className="text-[8.5px] bg-slate-950 text-slate-300 px-1.5 py-0.5 rounded border border-slate-800/50 max-w-[120px] truncate">
                      {link.modelName}
                    </span>
                  )}
                  {link.vehicleType && (
                    <span className="text-[8.5px] bg-slate-950 text-indigo-400 px-1.5 py-0.5 rounded border border-slate-800/50">
                      {link.vehicleType}
                    </span>
                  )}
                  {link.price && (
                    <span className="text-[8.5px] bg-emerald-950/40 text-emerald-400 px-1.5 py-0.5 rounded font-extrabold border border-emerald-500/20">
                      {link.price} {link.priceType ? `(${link.priceType})` : ''}
                    </span>
                  )}
                  {link.monthlyPayment && (
                    <span className="text-[8.5px] bg-sky-950/30 text-sky-400 px-1.5 py-0.5 rounded font-bold border border-sky-500/20">
                      {link.monthlyPayment}
                    </span>
                  )}
                </div>
              )}

              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] truncate break-all flex items-center gap-1 transition-colors text-slate-400 hover:text-teal-400"
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