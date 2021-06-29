import { TLogLevel } from './defs';
export declare const LOGGER_LOG: {
    level: string;
};
export declare const LOGGER_NONE: {
    level: string;
};
export declare const LOGGER_LEVELS: {
    debug: number;
    log: number;
    info: number;
    warn: number;
    error: number;
    none: number;
};
export default class Logger {
    conf: any;
    level: any;
    constructor(conf: {
        level: string;
    });
    static shouldLog(level: number, name: TLogLevel): boolean;
    out(what: TLogLevel, args: any): void;
    debug: (args: any) => void;
    log: (args: any) => void;
    info: (args: any) => void;
    warn: (args: any) => void;
    error: (args: any) => void;
}
//# sourceMappingURL=Logger.d.ts.map