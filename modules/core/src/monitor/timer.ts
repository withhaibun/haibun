/**
 * Browser-safe Timer for monitor modules.
 * Duplicated from lib/Timer.ts to avoid pulling in transitive dependencies.
 */
export class Timer {
  static startTime = new Date();
  static key = `${Timer.startTime.getTime()}`;
  static START_TIME = Date.now();

  static since() {
    return Date.now() - Timer.START_TIME;
  }
}
