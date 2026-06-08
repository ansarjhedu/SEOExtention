import React from 'react';

export default function SummaryWidgets({ links }) {
  const totals = {
    all: links.length,
    page: links.filter(l => l.category === 'page').length, 
    product: links.filter(l => l.category === 'product').length,
    collection: links.filter(l => l.category === 'collection').length,
    blog: links.filter(l => l.category === 'blog').length,
    broken: links.filter(l => l.category === 'broken').length, // Broken Links Count
  };

  const metrics = [
    { key: 'all', label: 'All', color: 'text-slate-200', bg: 'bg-slate-900/40' },
    { key: 'page', label: 'Pages', color: 'text-violet-400', bg: 'bg-violet-950/10' },
    { key: 'product', label: 'Products', color: 'text-emerald-400', bg: 'bg-emerald-950/10' },
    { key: 'collection', label: 'Colls', color: 'text-sky-400', bg: 'bg-sky-950/10' },
    { key: 'blog', label: 'Blogs', color: 'text-amber-400', bg: 'bg-amber-950/10' },
    { key: 'broken', label: 'Broken', color: 'text-rose-400', bg: 'bg-rose-950/10' }, // Highlighted in Rose
  ];

  return (
    <div className="grid grid-cols-3 gap-2 bg-slate-900/60 p-2 border border-slate-800/60 rounded-lg animate-fade-in">
      {metrics.map((item) => (
        <div key={item.key} className={`text-center py-2 px-1 rounded-md border border-slate-800/30 ${item.bg}`}>
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{item.label}</div>
          <div className={`text-sm font-semibold mt-0.5 ${item.color}`}>{totals[item.key]}</div>
        </div>
      ))}
    </div>
  );
}