import Logger from './Logger.js';
import { IConnectedLogger, ILoggerKeepAlive, ILogOutput, TLogLevel, TOutputEnv } from './interfaces/logger.js';
import { TMessageContext } from './interfaces/messageContexts.js';
import { TAnyFixme, TTag } from './defs.js';

export class ConnectedLogger extends Logger implements IConnectedLogger {
	keepalive?: ILoggerKeepAlive;
	constructor(output: ILogOutput, tag: TTag) {
		const res: TOutputEnv = { output, tag };
		super(res);
	}
	async connect() {
		await this.keepalive?.start();
	}

	async disconnect() {
		await this.keepalive?.stop();
	}

	addKeepalive(keepAlive: ILoggerKeepAlive) {
		this.keepalive = keepAlive;
	}

	out(level: TLogLevel, message: TAnyFixme, mctx?: TMessageContext) {
		const content = { message, level, mctx };
		console.error(`fixme; topic changed to context ${content}`);
	}
}
