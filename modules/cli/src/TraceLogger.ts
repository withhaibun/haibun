import { TLogLevel, TLogMessage, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';

export default class TraceLogger {
	logData: { level: TLogLevel; message: TLogMessage; messageContext: TMessageContext }[] = [];
	out(level: TLogLevel, message: TLogMessage, messageContext?: TMessageContext) {
		this.logData.push({ level, message, messageContext });
	}
	getLogData() {
		return this.logData;
	}
}
