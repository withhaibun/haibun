
export class Timer {
  static startTime = new Date();
  static START_TIME = process.hrtime();
  since() {
    const [s, ns] = process.hrtime(Timer.START_TIME);
    return s + ns / 1000000000;
  }
}
