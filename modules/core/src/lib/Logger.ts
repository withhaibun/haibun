import { TTag } from './defs.js';
import { ILogger, ILogOutput, TLogArgs, TLogHistory, TLogLevel, TMessageContext, TOutputEnv } from './interfaces/logger.js';
import { descTag, isFirstTag } from './util/index.js';

export const LOGGER_LOG = { level: 'log' };
export const LOGGER_NOTHING = { level: 'none' };
export const LOGGER_LEVELS = {
  debug: 1,
  log: 2,
  info: 3,
  warn: 4,
  error: 5,
  none: 9,
};

type TLevel = { level: string; follow?: string };
type TConf = TLevel | TOutputEnv;

export default class Logger implements ILogger, ILogOutput {
  level: number | undefined = 1;
  env: TOutputEnv | undefined;
  subscribers: ILogOutput[] = [];
  follow: string | undefined;
  static lastLevel = undefined;
  static history: TLogHistory[] = [];

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
    const res = new RegExp(match).test(`${tag.sequence}`);
    return res;
  }
  out(level: TLogLevel, args: TLogArgs, messageContext?: TMessageContext) {
    Logger.history.push({ messageContext, message: args, level });

    for (const subscriber of this.subscribers) {
      subscriber.out(level, args, messageContext);
    }
    if (this.env?.output) {
      this.env.output.out(level, args, { ...messageContext, tag: this.env.tag });
      return;
    }
    if (!Logger.shouldLogLevel(this.level as number, level) && Logger.shouldLogFollow(this.follow, this.env?.tag)) {
      return;
    }
    const showLevel = Logger.lastLevel === level ? level.substring(0, 1).padStart(1 + level.length / 2) : level;
    Logger.lastLevel = level;
    const e = Error().stack?.split('\n');
    const ln = e[Math.min((e?.length || 1) - 1, 4)]?.replace(/.*\(/, '')?.replace(process.cwd(), '').replace(')', '').replace(/.*\//, '').replace(/\.ts:/, ':');
    const tag = messageContext?.tag ? (isFirstTag(messageContext.tag) ? '' : descTag(messageContext.tag)) : '';
    const [proggy, line /*, col*/] = ln.split(':');
    console[level]((showLevel.padStart(6) + ` █ ${proggy}:${line}${tag}`).padEnd(30) + ` ｜ `, args);
  }
  debug = (args: TLogArgs, mctx?: TMessageContext) => this.out('debug', args, mctx);
  log = (args: TLogArgs, mctx?: TMessageContext) => this.out('log', args, mctx);
  info = (args: TLogArgs, mctx?: TMessageContext) => this.out('info', args, mctx);
  warn = (args: TLogArgs, mctx?: TMessageContext) => this.out('warn', args, mctx);
  error = (args: TLogArgs, mctx?: TMessageContext) => this.out('error', args, mctx);
}
