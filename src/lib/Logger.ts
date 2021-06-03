export default class Logger {
  constructor() {}
  debug = (what: any) => undefined; //console.debug;
//   debug = console.debug;
  log = console.log;
  info = console.info;
  warn = console.warn;
  error = console.error;
}
