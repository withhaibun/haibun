import { describe, it, expect } from 'vitest';

import LoggerWebsockets from "./logger-websockets-server.js";

describe('logger-websockets', () => {
    it('exists', () => {
        expect(LoggerWebsockets).toBeDefined();
    })
})
