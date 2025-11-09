import { ILogger } from './interfaces/logger.js';

const nothin = () => undefined;
export default class TestLogger implements ILogger {
	debug = nothin;
	trace = nothin;
	log = nothin;
	info = nothin;
	warn = nothin;
	error = nothin;
	addSubscriber = nothin;
	removeSubscriber = nothin;
}
