import { describe, test, expect } from 'vitest';
import TraceLogger from './TraceLogger';
import Logger from '@haibun/core/src/lib/Logger';
import { TBasicMessageContext } from '@haibun/core/build/lib/interfaces/logger';
import { getRunTag } from '@haibun/core/src/lib/util';

describe('TraceLogger', () => {
	test('should access the trace history via subscriber', () => {
		const logger = new Logger({ level: 'debug' });
		const traceLogger = new TraceLogger();
		logger.addSubscriber(traceLogger);
		const message = 'test message';
		const messageContext = <TBasicMessageContext>{ topic: { stage: 'Testing' }, tag: getRunTag(0, 0) };
		logger.log(message, messageContext);
		expect(traceLogger.getLogData()).toEqual([{ level: 'log', message, messageContext }]);
	});
});
