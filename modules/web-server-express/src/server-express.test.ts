import { it, expect, describe } from 'vitest';

import { ServerExpress } from "./server-express.js"
import TestLogger from '@haibun/core/build/lib/TestLogger.js';

describe('mounts', () => {
    it('mounts a route', () => {
        const tl = new TestLogger();
        const se = new ServerExpress(tl, '/', 8999);
        se.listen = async () => 'started';
        expect(() => se.addRoute('get', '/', () => undefined)).not.toThrow();
    });
    it.skip('throws instead of double mounting a route', () => {
        const tl = new TestLogger();
        const se = new ServerExpress(tl, '/', 8999);
        se.listen = async () => 'started';
        void expect(async () => se.addRoute('get', '/', () => undefined)).rejects.toThrow();
    });
});