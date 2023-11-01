import { ILogOutput, TExecutorMessageContext, TExecutorResultTopic, TLogArgs, TMessageContext } from './interfaces/logger.js';
import Logger, { LOGGER_LEVELS } from './Logger.js';
import { getDefaultTag } from './test/lib.js';

describe('log levels', () => {
  test('logs none with none', () => {
    expect(Logger.shouldLogLevel(LOGGER_LEVELS['none'], 'debug')).toBe(false);
    expect(Logger.shouldLogLevel(LOGGER_LEVELS['none'], 'info')).toBe(false);
  });
  test('logs log with log', () => {
    expect(Logger.shouldLogLevel(LOGGER_LEVELS['log'], 'log')).toBe(true);
  });
  test('does not log debug with log', () => {
    expect(Logger.shouldLogLevel(LOGGER_LEVELS['log'], 'debug')).toBe(false);
  });
});

describe('logger with subscriber', () => {
  test.skip('subscriber receives topic', (done) => {
    const logger = new Logger({ level: 'debug' });
    const tag = getDefaultTag(0);
    // FIXME
    const step = { '@type': 'Step', description: 'step 1', actions: [], source: { path: 'path', type: 'foo', base: 'foo', name: 'foo', content: 'foo' }, in: 'in', seq: 1 };
    const subscriber: ILogOutput = {
      out(level: string, args: TLogArgs, ctx?: TExecutorMessageContext) {
        expect(ctx.topic).toBeDefined();
        expect((ctx.topic as TExecutorResultTopic).result).toEqual(step);
        done();
      },
    };
    logger.addSubscriber(subscriber);
    // FIXME
    // logger.log('test', <TExecutorMessageContext>{ topic: { stage: 'Executor', result: { step } }, tag });
  });
});

describe('logger with output', () => {
  test('output gets current tag', (done) => {
    const output: ILogOutput = {
      out(level: string, args: TLogArgs, ctx?: TMessageContext) {
        expect(ctx?.tag?.loop).toBe(0);
        done();
      },
    };
    const dlogger = new Logger({ output, tag: getDefaultTag(0) });

    dlogger.log('test');
  });
});
