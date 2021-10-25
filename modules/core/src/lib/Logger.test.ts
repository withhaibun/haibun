import { ILogOutput, TEST_RESULT, TMessageContext } from './interfaces/logger';
import Logger, { loggerTag, LOGGER_LEVELS } from './Logger';

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
describe('log follow', () => {
  test('logs follow', () => {
    expect(Logger.shouldLogFollow('-m[1-3]', loggerTag(1, 2, {}))).toBe(true);
  });
  test('log does not follow', () => {
    expect(Logger.shouldLogFollow('-m[1-3]', loggerTag(1, 5, {}))).toBe(false);
  });
});

describe('logger with subscriber', () => {
  test('subscriber receives topic', (done) => {
    const logger = new Logger({ level: 'debug' });
    const subscriber: ILogOutput = {
      out(level: string, args: any[], ctx?: TMessageContext) {
        expect(ctx!.topic).toBeDefined();
        expect(ctx!.topic!.result).toEqual(TEST_RESULT);
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
      out(level: string, args: any[], ctx?: TMessageContext) {
        expect(ctx!.tag).toBe('current');
        done();
      },
    };
    const dlogger = new Logger({ output, tag: 'current' });

    dlogger.log('test');
  });
});
