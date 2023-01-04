import { ILogger } from "./interfaces/logger";

export default class TestLogger implements ILogger {
    debug(...args: any) { }
    log(...args: any) { }
    info(...args: any) { }
    warn(...args: any) { }
    error(...args: any) { }
    addSubscriber(...args: any) { }
}