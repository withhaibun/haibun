import { TTag, TWorld, TAnyFixme } from './defs.js'; // Added TAnyFixme
import { TArtifact } from './interfaces/artifacts.js';
import { ILogger, ILogOutput, TLogArgs, TLogLevel, TOutputEnv, EExecutionMessageType } from './interfaces/logger.js'; // Added EExecutionMessageType
import { TMessageContext } from './interfaces/messageContexts.js'; // Removed TMessageContextTopic
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
}

// Convenience function to create a log with message context and artifact
export const topicArtifactLogger = (world: TWorld) => <T extends TArtifact>(
	message: TLogArgs,
	data: { incident: EExecutionMessageType, artifact?: T, incidentDetails?: TAnyFixme },
	level: TLogLevel = 'log'
): void => {
	const context: TMessageContext = {
		incident: data.incident,
		artifact: data.artifact,
		incidentDetails: data.incidentDetails,
		tag: world.tag // Automatically add the tag from the curried world
	};
	world.logger[level](message, context);
}
