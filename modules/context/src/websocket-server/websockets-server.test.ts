import { it, expect, describe } from 'vitest';

import LoggerWebSockets from "./websockets-server.js";
describe('logger-websockets', () => {
    it('exists', () => {
        expect(LoggerWebSockets).toBeDefined();
    })
})
