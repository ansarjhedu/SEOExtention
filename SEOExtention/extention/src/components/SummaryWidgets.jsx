// components/SummaryWidgets.js

import React from 'react';

export default function SummaryWidgets({ links }) {
  const totals = {
    all: links.length,
    inventory: links.filter(l => l.category === 'inventory').length,
    collections: links.filter(l => l.category === 'collection').length,
    vehicles: links.filter(l => l.category === 'product').length,
    promotions: links.filter(l => l.category === 'page' && l.subCategory === 'promotion-page').length,
    parts: links.filter(l => l.category === 'page' && l.subCategory === 'parts-page').length,
    blogs: links.filter(l => l.category === 'blog').length,
    error404: links.filter(l => l.category === '404').length, // Added 404 tracker
  };

  const metrics = [
    { key: 'all', label: 'All', color: 'text-slate-200', bg: 'bg-slate-900/40' },
    { key: 'inventory', label: 'Inventory', color: 'text-sky-400', bg: 'bg-sky-950/10' },
    { key: 'collections', label: 'Brands', color: 'text-violet-400', bg: 'bg-violet-950/10' },
    { key: 'vehicles', label: 'Products', color: 'text-emerald-400', bg: 'bg-emerald-950/10' },
    { key: 'promotions', label: 'Promos', color: 'text-indigo-400', bg: 'bg-indigo-950/10' },
    { key: 'parts', label: 'Parts', color: 'text-rose-400', bg: 'bg-rose-950/10' },
    { key: 'blogs', label: 'Blogs', color: 'text-amber-400', bg: 'bg-amber-950/10' }, // Added
    { key: 'error404', label: '404s', color: 'text-red-500', bg: 'bg-red-950/10' }, // Added
  ];

  return (
    <div className="grid grid-cols-4 gap-2 bg-slate-900/60 p-2 border border-slate-800/60 rounded-lg animate-fade-in">
      {metrics.map((item) => (
        <div key={item.key} className={`text-center py-2 px-1 rounded-md border border-slate-800/30 ${item.bg}`}>
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{item.label}</div>
          <div className={`text-sm font-semibold mt-0.5 ${item.color}`}>{totals[item.key]}</div>
        </div>
      ))}
    </div>
  );
}