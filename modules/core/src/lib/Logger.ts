import { TLogger, ISubscriber, TLogLevel } from "./interfaces/logger";

export const LOGGER_LOG = { level: 'log' };
export const LOGGER_NONE = { level: 'none' };
const WIDTH = process.cwd().length + 40;

export const LOGGER_LEVELS = {
  debug: 1,
  log: 2,
  info: 3,
  warn: 4,
  error: 5,
  none: 9,
};

export default class Logger implements TLogger {
  conf: any;
  level: any;
  subscribers: ISubscriber[] = [];

  constructor(conf: { level: string }) {
    this.conf = conf;
    this.level = LOGGER_LEVELS[conf.level as TLogLevel];
  }

  addSubscriber(subscriber: ISubscriber) {
    this.subscribers.push(subscriber);
  }
  static shouldLog(level: number, name: TLogLevel) {
    return LOGGER_LEVELS[name] >= level;
  }
  out(level: TLogLevel, args: any) {
    if (!Logger.shouldLog(this.level, level)) {
      return;
    }
    const e = Error(level).stack?.split('\n');
    const ln = e![Math.min((e?.length || 1) - 1, 4)]?.replace(/.*\(/, '')?.replace(process.cwd(), '').replace(')', '');

    for (const subscriber of this.subscribers) {
      subscriber.out(level, args);
    }
    (console as any)[level].call(console, `${ln}: `.padStart(WIDTH), level.padStart(6), args);
  }
  debug = (args: any) => this.out('debug', args);
  log = (args: any) => this.out('log', args);
  info = (args: any) => this.out('info', args);
  warn = (args: any) => this.out('warn', args);
  error = (args: any) => this.out('error', args);
}
