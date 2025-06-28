// Test port constants to avoid conflicts with live server instances
// Live servers use ports 8123-8125, so tests use 12000+ range
// Each category gets a 100-port range for expansion

export const TEST_PORTS = {
  // HTTP Executor tests (12000-12099)
  HTTP_EXECUTOR_BASE: 12001,
  HTTP_EXECUTOR_AUTH: 12002,
  HTTP_EXECUTOR_RETRY: 12003,
  HTTP_EXECUTOR_TIMEOUT: 12004,

  // Web server tests (12100-12199)
  WEB_SERVER_FILES: 12101,
  WEB_SERVER_ROUTE: 12102,
  WEB_SERVER_EXPRESS: 12103,
  WEB_SERVER_INDEX: 12104,
  WEB_SERVER_STATIC: 12105,

  // Web Playwright tests (12200-12299)
  WEB_PLAYWRIGHT: 12201,
  WEB_PLAYWRIGHT_BROWSER: 12202,
  WEB_PLAYWRIGHT_HEADLESS: 12203,
} as const;
