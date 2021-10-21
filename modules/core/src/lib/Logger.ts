import { TLogger, ISubscriber, TLogLevel, TMessageTopic } from './interfaces/logger';

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
  out(level: TLogLevel, args: any, messageTopic?: TMessageTopic) {
    if (!Logger.shouldLog(this.level, level)) {
      return;
    }
    const e = Error(level).stack?.split('\n');
    const ln = e![Math.min((e?.length || 1) - 1, 4)]?.replace(/.*\(/, '')?.replace(process.cwd(), '').replace(')', '');

    for (const subscriber of this.subscribers) {
      subscriber.out(level, args, messageTopic);
    }
    
    (console as any)[level].call(console, `${ln}: `.padStart(WIDTH), args, level.padStart(6));
  }
  debug = (args: any, topic?: TMessageTopic) => this.out('debug', args, topic);
  log = (args: any, topic?: TMessageTopic) => this.out('log', args, topic);
  info = (args: any, topic?: TMessageTopic) => this.out('info', args, topic);
  warn = (args: any, topic?: TMessageTopic) => this.out('warn', args, topic);
  error = (args: any, topic?: TMessageTopic) => this.out('error', args, topic);
}
