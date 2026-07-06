// components/CrawlProgress.js

import React from 'react';

export default function CrawlProgress({ 
  scanning, 
  crawlMode, 
  backendStatus, 
  crawlProgress, 
  pagesCrawled, 
  queueSize,
  dealershipProfile 
}) {
  if (!scanning || crawlMode !== 'deep') return null;

  const totalDiscovered = pagesCrawled + queueSize;

  // 1. Map all targets into a verifiable tracking manifest matching deployment specs
  const auditFields = [
    { label: 'Dealership Name', val: dealershipProfile?.dealershipName, tier: 'VERIFIED' },
    { label: 'Legal Corp Name', val: dealershipProfile?.legalCorporateName, tier: 'VERIFIED' },
    { label: 'Main Telephone', val: dealershipProfile?.telephoneMainLine, tier: 'VERIFIED' },
    { label: 'Fax Number Line', val: dealershipProfile?.telephoneFax, tier: 'VERIFIED' },
    { label: 'Website Platform', val: dealershipProfile?.platform, tier: 'VERIFIED' },
    { label: 'Brand Logo Asset', val: dealershipProfile?.logoUrl, tier: 'VERIFIED' },
    { label: 'Google Business URL', val: dealershipProfile?.googleBusinessUrl, tier: 'VERIFIED' },
    { label: 'GPS Coordinates (Lat)', val: dealershipProfile?.latitude, tier: 'INFERRED' },
    { label: 'GPS Coordinates (Lng)', val: dealershipProfile?.longitude, tier: 'INFERRED' },
    { label: 'Phone: Sales Dept', val: dealershipProfile?.departmentPhones?.sales, tier: 'VERIFIED' },
    { label: 'Phone: Service Dept', val: dealershipProfile?.departmentPhones?.service, tier: 'VERIFIED' },
    { label: 'Phone: Parts Dept', val: dealershipProfile?.departmentPhones?.parts, tier: 'VERIFIED' },
    { label: 'Required URL: Parts', val: dealershipProfile?.requiredUrls?.parts, tier: 'VERIFIED' },
    { label: 'Required URL: Service', val: dealershipProfile?.requiredUrls?.service, tier: 'VERIFIED' },
    { label: 'Required URL: Finance', val: dealershipProfile?.requiredUrls?.finance, tier: 'VERIFIED' },
    { label: 'Action: Service Scheduler', val: dealershipProfile?.actionUrls?.serviceScheduler, tier: 'VERIFIED' },
    { label: 'Action: Parts Request', val: dealershipProfile?.actionUrls?.partsRequest, tier: 'VERIFIED' },
    { label: 'Action: Trade-In Valuation', val: dealershipProfile?.actionUrls?.tradeIn, tier: 'VERIFIED' },
    { label: 'Action: Test Ride Booking', val: dealershipProfile?.actionUrls?.testRide, tier: 'VERIFIED' },
    { label: 'Action: Google Reviews', val: dealershipProfile?.actionUrls?.googleReviews, tier: 'VERIFIED' },
    { label: 'Content: Staff / Team', val: dealershipProfile?.actionUrls?.staff, tier: 'VERIFIED' },
    { label: 'Content: Blog / News', val: dealershipProfile?.actionUrls?.blog, tier: 'VERIFIED' },
    { label: 'Content: Events', val: dealershipProfile?.actionUrls?.events, tier: 'VERIFIED' },
    { label: 'Content: Testimonials', val: dealershipProfile?.actionUrls?.testimonials, tier: 'VERIFIED' },
    { label: 'Social: Facebook', val: dealershipProfile?.socialLinks?.facebook, tier: 'VERIFIED' },
    { label: 'Social: Instagram', val: dealershipProfile?.socialLinks?.instagram, tier: 'VERIFIED' },
    { label: 'Social: YouTube', val: dealershipProfile?.socialLinks?.youtube, tier: 'VERIFIED' },
    { label: 'Social: Twitter/X', val: dealershipProfile?.socialLinks?.twitter, tier: 'VERIFIED' },
    { label: 'Store Hours: Monday', val: dealershipProfile?.storeHours?.monday, tier: 'VERIFIED' },
    { label: 'Store Hours: Sunday', val: dealershipProfile?.storeHours?.sunday, tier: 'VERIFIED' },
    { label: 'Service Hours: Monday', val: dealershipProfile?.serviceHours?.monday, tier: 'VERIFIED' },
    { label: 'Service Hours: Sunday', val: dealershipProfile?.serviceHours?.sunday, tier: 'VERIFIED' },
    { label: 'New Inventory %', val: dealershipProfile?.inventoryMetrics?.newPercentage, tier: 'INFERRED' },
    { label: 'Used Inventory %', val: dealershipProfile?.inventoryMetrics?.usedPercentage, tier: 'INFERRED' },
  ];

  // 2. Compute dynamic metrics configurations in real-time
  const totalTrackedFields = auditFields.length;
  const fetchedFieldsCount = auditFields.filter(f => f.val && String(f.val).trim() !== '').length;

  return (
    <div className="bg-slate-900 border border-[#1b3a5c] rounded-lg p-3.5 flex flex-col gap-3.5 animate-fade-in shadow-xl">
      
      {/* Dynamic Progress Monitor */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-300 font-bold tracking-wide flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500 animate-pulse"></span>
            {backendStatus || 'Auditing active domain...'}
          </span>
          <span className="text-teal-400 font-extrabold text-sm">{crawlProgress}%</span>
        </div>
        
        {/* Progress bar tracking layout */}
        <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800/50">
          <div 
            className="bg-gradient-to-r from-teal-500 via-indigo-500 to-emerald-500 h-full rounded-full transition-all duration-500"
            style={{ width: `${crawlProgress}%` }}
          ></div>
        </div>

        <div className="flex justify-between items-center mt-1 text-[10px] font-bold text-slate-400 px-0.5 border-b border-slate-800/40 pb-2">
          <span>Pages Scanned: <span className="text-slate-200">{pagesCrawled}</span></span>
          <span>Indexed Stack: <span className="text-indigo-400">{totalDiscovered} URLs</span></span>
        </div>
      </div>

      {/* Real-time Business Intelligence Manifest Monitor */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[10px] uppercase font-black tracking-wider text-slate-400 border-b border-slate-800/40 pb-1.5">
          <span>Live Intake Verification Manifest</span>
          <span className="text-teal-400 font-mono text-xs">
            {fetchedFieldsCount} / {totalTrackedFields} Fields Found
          </span>
        </div>

        {/* Scrollable Audit Grid view displaying live discoveries */}
        <div className="flex flex-col gap-1.5 max-h-[190px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
          {auditFields.map((field, idx) => {
            const hasData = field.val && String(field.val).trim() !== '';
            
            // Resolve exact tier status configuration colors
            let badgeText = 'MISSING';
            let badgeStyle = 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
            
            if (hasData) {
              if (field.tier === 'INFERRED') {
                badgeText = 'INFERRED';
                badgeStyle = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
              } else {
                badgeText = 'VERIFIED';
                badgeStyle = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
              }
            }

            return (
              <div 
                key={idx} 
                className={`flex items-center justify-between p-2 rounded border text-[10px] transition-all duration-200
                  ${hasData ? 'bg-slate-950/50 border-slate-800/60' : 'bg-slate-950/20 border-slate-900/40 opacity-40'}`}
              >
                <div className="flex flex-col gap-0.5 truncate max-w-[190px]">
                  <span className="font-bold text-slate-300 truncate">{field.label}</span>
                  <span className="text-[9px] text-slate-500 truncate italic">
                    {hasData ? String(field.val) : 'Searching source code...'}
                  </span>
                </div>
                
                <span className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-widest shrink-0 ${badgeStyle}`}>
                  {badgeText}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}