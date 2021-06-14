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
