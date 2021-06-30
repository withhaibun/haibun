"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOGGER_LEVELS = exports.LOGGER_NONE = exports.LOGGER_LOG = void 0;
exports.LOGGER_LOG = { level: 'log' };
exports.LOGGER_NONE = { level: 'none' };
const WIDTH = process.cwd().length + 40;
exports.LOGGER_LEVELS = {
    debug: 1,
    log: 2,
    info: 3,
    warn: 4,
    error: 5,
    none: 9,
};
class Logger {
    constructor(conf) {
        this.debug = (args) => this.out('debug', args);
        this.log = (args) => this.out('log', args);
        this.info = (args) => this.out('info', args);
        this.warn = (args) => this.out('warn', args);
        this.error = (args) => this.out('error', args);
        this.conf = conf;
        this.level = exports.LOGGER_LEVELS[conf.level];
    }
    static shouldLog(level, name) {
        return exports.LOGGER_LEVELS[name] >= level;
    }
    out(what, args) {
        if (!Logger.shouldLog(this.level, what)) {
            return;
        }
        const e = Error(what).stack?.split('\n');
        const ln = e[Math.min((e?.length || 1) - 1, 4)]?.replace(/.*\(/, '')?.replace(process.cwd(), '').replace(')', '');
        console[what].call(console, `${ln}: `.padStart(WIDTH), what.padStart(6), args);
    }
}
exports.default = Logger;
//# sourceMappingURL=Logger.js.map