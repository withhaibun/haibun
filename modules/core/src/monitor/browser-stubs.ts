/**
 * Browser stubs for Haibun core modules.
 * 
 * This file provides empty/stub exports for modules that are imported by legacy
 * web-playwright monitor code but not actually used at runtime in the browser.
 * 
 * This allows the vite browser build to succeed without pulling in Node.js deps.
 */

// Stub for TAnyFixme from fixme.js
export type TAnyFixme = any;

// Stub for defs.js types that may be referenced but not used in browser
export type TResolvedFeature = any;

// Stub for utils that aren't used in browser  
export function shortenURI(uri: string): string {
  // Simple implementation for browser
  try {
    const url = new URL(uri);
    return url.pathname.split('/').pop() || uri;
  } catch {
    return uri;
  }
}
