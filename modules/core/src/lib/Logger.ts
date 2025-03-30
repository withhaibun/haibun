import { TAnyFixme, TTag } from './defs.js';
import { ILogger, ILogOutput, TActionStage, TArtifactMessageContext, TArtifactType, TLogArgs, TLogLevel, TMessageContext, TOutputEnv, } from './interfaces/logger.js';
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

	constructor(conf: TConf) {
		// passed a log level and possibly a follow
		if ((conf as TLevel).level) {
			this.level = LOGGER_LEVELS[(conf as TLevel).level as TLogLevel];
			this.follow = (conf as TLevel).follow;
		} else if ((conf as TOutputEnv).output) {
			this.env = conf as TOutputEnv;
		} else {
			throw Error(`invalid logger config ${conf}`);
		}
	}

	addSubscriber(subscriber: ILogOutput) {
		this.subscribers.push(subscriber);
	}
	removeSubscriber(subscriber: ILogOutput) {
		this.subscribers = this.subscribers.filter((sub) => JSON.stringify(sub) !== JSON.stringify(subscriber));
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
		for (const subscriber of this.subscribers) {
			subscriber.out(level, args, messageContext);
		}
		if (this.env?.output) {
			this.env.output.out(level, args, { ...messageContext, tag: this.env.tag });
			return;
		}
		const stack = Error().stack?.split('\n');
		const caller = stack[Math.min((stack?.length || 1) - 1, 4)]
			?.replace(/.*\(/, '')
			?.replace(process.cwd(), '')
			.replace(')', '')
			.replace(/.*\//, '')
			.replace(/\.ts:/, ':');
		if (!Logger.shouldLogLevel(this.level as number, level) && Logger.shouldLogFollow(this.follow, this.env?.tag)) {
			return;
		}
		const showLevel = Logger.lastLevel === level ? level.substring(0, 1).padStart(1 + level.length / 2) : level;
		Logger.lastLevel = level;
		const tag = messageContext?.tag ? (isFirstTag(messageContext.tag) ? '' : descTag(messageContext.tag)) : '';
		const [proggy, line /*, col*/] = caller.split(':');
		console[level]((showLevel.padStart(6) + ` █ ${proggy}:${line}${tag}`).padEnd(30) + ` ｜ `, args);
	}
	debug = (args: TLogArgs, mctx?: TMessageContext) => this.out('debug', args, mctx);
	log = (args: TLogArgs, mctx?: TMessageContext) => this.out('log', args, mctx);
	info = (args: TLogArgs, mctx?: TMessageContext) => this.out('info', args, mctx);
	warn = (args: TLogArgs, mctx?: TMessageContext) => this.out('warn', args, mctx);
	error = (args: TLogArgs, mctx?: TMessageContext) => this.out('error', args, mctx);

	static logContext({
		details,
		stage,
		type,
		path,
		event,
		tag,
		content,
	}: {
		details: TAnyFixme;
		stage: TActionStage;
		type: TArtifactType;
		path?: string;
		content?: string;
		event: string;
		tag: TTag;
	}): TArtifactMessageContext {
		return { topic: { ...details, event, stage }, artifact: { type, path, content }, tag };
	}
}
