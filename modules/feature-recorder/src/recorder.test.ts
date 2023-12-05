import { vitest, describe, it, expect } from 'vitest';
vitest.useFakeTimers()

import LoggerWebSocketsClient from '@haibun/context/build/websocket-client/LoggerWebSocketsClient.js';
import { record } from './recorder.js';

// setTimeout(5000);
const onmessage = (message: MessageEvent) => {
    console.log('🤑->>', message);
}
describe('recorder', () => {
    it.skip('should record', async (done) => {
        const loggerWebSocketsClient = new LoggerWebSocketsClient(3931, { onmessage });
        const promise = record('http://localhost:8126/form.html', ['test']);
        await promise.then((res) => {
            expect(res.ok).toBe(true);
            // done();
        });
    });
});
