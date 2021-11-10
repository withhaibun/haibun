import { TTag } from './defs';
import { ILogger, ILogOutput, TLogLevel, TMessageContext } from './interfaces/logger';
import { descTag } from './util';

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

type TLevel = { level: string, follow?: string };
type TOutputEnv = { output: ILogOutput, tag: TTag };
type TConf = TLevel | TOutputEnv;

export default class Logger implements ILogger, ILogOutput {
  level: number | undefined;
  env: TOutputEnv | undefined;
  subscribers: ILogOutput[] = [];
  follow: string | undefined;

  constructor(conf: TConf) {
    // passed a log level and possibly a follow
    if ((conf as TLevel).level) {
      this.level = LOGGER_LEVELS[(conf as TLevel).level as TLogLevel];
      this.follow = (conf as TLevel).follow;
    } else {
      this.env = conf as TOutputEnv;
    }
  }

  addSubscriber(subscriber: ILogOutput) {
    this.subscribers.push(subscriber);
  }
  static shouldLogLevel(level: number, name: TLogLevel) {
    return LOGGER_LEVELS[name] >= level;
  }
  static shouldLogFollow(match: string, tag: TTag) {
    if (!match || !tag) {
      return true;
    }
    const res = new RegExp(match).test(`${tag.sequence}`)
    return res;
  }
  out(level: TLogLevel, args: any, messageContext?: TMessageContext) {
    if (this.env?.output) {
      this.env.output.out(level, args, { ...messageContext, tag: this.env.tag });
      return;
    }
    if (!Logger.shouldLogLevel(this.level as number, level) && Logger.shouldLogFollow(this.follow!, this.env?.tag!)) {
      return;
    }
    const e = Error(level).stack?.split('\n');
    const ln = e![Math.min((e?.length || 1) - 1, 4)]?.replace(/.*\(/, '')?.replace(process.cwd(), '').replace(')', '');

    for (const subscriber of this.subscribers) {
      subscriber.out(level, args, messageContext);
    }
    const tag = messageContext?.tag ? descTag(messageContext.tag) : '';
    (console as any)[level](`${ln}${tag}: `.padStart(WIDTH), args, level.padStart(6));
  }
  debug = (args: any, mctx?: TMessageContext) => this.out('debug', args, mctx);
  log = (args: any, mctx?: TMessageContext) => this.out('log', args, mctx);
  info = (args: any, mctx?: TMessageContext) => this.out('info', args, mctx);
  warn = (args: any, mctx?: TMessageContext) => this.out('warn', args, mctx);
  error = (args: any, mctx?: TMessageContext) => this.out('error', args, mctx);
}
