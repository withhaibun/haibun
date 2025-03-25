export class Timer {
	static startTime = new Date();
	static key = `${Timer.startTime.getTime()}`;
	static START_TIME = Date.now();
	static setKey(newKey: string) {
		Timer.key = newKey;
	}

	since() {
		return Date.now() - Timer.START_TIME;
	}
}
