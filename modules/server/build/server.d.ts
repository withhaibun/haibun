import { TLogger } from '@haibun/core/build/lib/defs';
export declare class HaibunServer {
    port: number;
    logger: TLogger;
    constructor(logger: TLogger, port: number);
    start(): void;
    addRoute(): void;
    addFiles(loc: string): void;
}
//# sourceMappingURL=server.d.ts.map