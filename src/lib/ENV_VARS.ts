export const ENV_VARS: { [name: string]: string } = {
  HAIBUN_OUTPUT: 'Output format (AsXUnit)',
  HAIBUN_LOG_LEVEL: 'log level (debug, log, info, warn, error, none)',
  HAIBUN_SPLIT_SHARED: 'Use vars for split launch (=ex=1,2,3)',
  PWDEBUG: '(web) Enable Playwright debugging (0 or 1)',
  HAIBUN_STEP_DELAY: 'ms to wait between every step',
  HAIBUN_STEP_WEB_CAPTURE: '(web) capture page for every step',
};
