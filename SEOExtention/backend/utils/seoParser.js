export const classifyLink = (urlStr, anchorText = '') => {
  const url = urlStr.toLowerCase();
  
  // Contact & Social
  if (url.startsWith('tel:') || url.startsWith('mailto:')) return 'contact';
  if (url.includes('facebook') || url.includes('instagram') || url.includes('twitter') || url.includes('linkedin') || url.includes('tiktok')) return 'social';
  
  // Content / Assets
  if (url.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|jpg|png|svg|webp|mp4|zip|rar)$/)) return 'content';

  // Structure
  if (url.includes('/products/')) return 'product';
  if (url.includes('/collections/')) return 'collection';
  if (url.includes('/blogs/') || url.includes('/articles/')) return 'blog';
  if (url.includes('/pages/')) return 'page';
  
  return 'other';
};