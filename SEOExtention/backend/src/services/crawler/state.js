// services/crawler/state.js

/**
 * Global map storing active crawl sessions.
 * Key: clean domain string
 * Value: session object
 */
export const activeCrawls = new Map();