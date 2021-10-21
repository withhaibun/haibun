import { ISubscriber, TEST_RESULT, TMessageTopic } from './interfaces/logger';
import Logger, { LOGGER_LEVELS } from './Logger';

describe('log levels', () => {
  test('logs none with none', () => {
    expect(Logger.shouldLog(LOGGER_LEVELS['none'], 'debug')).toBe(false);
    expect(Logger.shouldLog(LOGGER_LEVELS['none'], 'info')).toBe(false);
  });
  test('logs log with log', () => {
    expect(Logger.shouldLog(LOGGER_LEVELS['log'], 'log')).toBe(true);
  });
  test('does not log debug with log', () => {
    expect(Logger.shouldLog(LOGGER_LEVELS['log'], 'debug')).toBe(false);
  });
});

describe('subscriber', () => {
  test('subscriber receives topic', (done) => {
    const logger = new Logger({ level: 'debug' });
    const subscriber: ISubscriber = {
      out(level: string, args: any[], topic?: TMessageTopic) {
        expect(topic).toBeDefined();
        expect(topic!.result).toEqual(TEST_RESULT);
        done();
      },
    };
    logger.addSubscriber(subscriber);
    logger.log('test', { stage: 'Executor', result: TEST_RESULT, seq: 1 });
  });
});
