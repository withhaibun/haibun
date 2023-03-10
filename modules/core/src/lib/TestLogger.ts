import { ILogger } from './interfaces/logger.js';

const nothin = () => undefined;
export default class TestLogger implements ILogger {
  debug = nothin;
  log = nothin;
  info = nothin;
  warn = nothin;
  error = nothin;
  addSubscriber = nothin;
}
