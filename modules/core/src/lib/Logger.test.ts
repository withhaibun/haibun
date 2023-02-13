import { ILogOutput, TEST_RESULT, TExecutorTopic, TLogArgs, TMessageContext } from './interfaces/logger.js';
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
  test('subscriber receives topic', (done) => {
    const logger = new Logger({ level: 'debug' });
    const subscriber: ILogOutput = {
      out(level: string, args: TLogArgs, ctx?: TMessageContext) {
        expect(ctx!.topic).toBeDefined();
        expect((ctx!.topic! as TExecutorTopic).result).toEqual(TEST_RESULT);
        done();
      },
    };
    logger.addSubscriber(subscriber);
    logger.log('test', { topic: { stage: 'Executor', result: TEST_RESULT, seq: 1 } });
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
