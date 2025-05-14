export class Timer {
	static startTime = new Date();
	static key = `${Timer.startTime.getTime()}`;
	static START_TIME = Date.now();

	static since() {
		return Date.now() - Timer.START_TIME;
	}
}
