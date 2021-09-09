import { ISubscriber, TMessageTopic } from './interfaces/logger';
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
        expect(topic!.topics.test).toEqual(1);
        done();
      },
    };
    logger.addSubscriber(subscriber);
    logger.log('test', { stage: 'Executor', topics: { test: 1 }, seq: 1 });
  });
});
