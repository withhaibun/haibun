// Test port constants to avoid conflicts with live server instances
// Live servers use ports 8123-8125, so tests use 12000+ range
// Web Playwright tests get 12200-12299 range

export const TEST_PORTS = {
  // Web Playwright tests (12200-12299)
  WEB_PLAYWRIGHT: 12201,
  WEB_PLAYWRIGHT_BROWSER: 12202,
  WEB_PLAYWRIGHT_HEADLESS: 12203,
  WEB_PLAYWRIGHT_MOBILE: 12204,
  WEB_PLAYWRIGHT_API: 12205,
} as const;
