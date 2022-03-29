
export class Timer {
  static startTime = new Date();
  static key = `${Timer.startTime}`;
  static START_TIME = process.hrtime();
  static setKey(newKey: string) {
    Timer.key = newKey;
  }

  since() {
    const [s, ns] = process.hrtime(Timer.START_TIME);
    return s + ns / 1000000000;
  }
}
