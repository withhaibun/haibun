const noop = () => undefined;

export const LOGGER_CI = { ci: true };

export default class Logger {
  conf: any;
  constructor(conf: { ci: boolean }) {
    this.conf = conf;
  }
  out(what: string, args: any) {
    if (!this.conf?.ci) {
      return (console as any)[what](args);
    }
  }
  debug = (args: any) => this.out('debug', args);
  log = (args: any) => this.out('log', args);
  info = (args: any) => this.out('info', args);
  warn = (args: any) => this.out('warn', args);
  error = (args: any) => this.out('error', args);
}
