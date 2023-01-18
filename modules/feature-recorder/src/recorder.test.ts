import { jest } from '@jest/globals';

import LoggerWebSocketsClient from '@haibun/context/build/websocket-client/LoggerWebSocketsClient.js';
import { record } from './recorder.js';

jest.setTimeout(5000);
const onmessage = (message: MessageEvent) => {
    console.log('🤑->>', message);
}
describe('recorder', () => {
    xit('should record', (done) => {
        const loggerWebSocketsClient = new LoggerWebSocketsClient(3931, { onmessage });
        const promise = record('http://localhost:8126/form.html', ['test']);
        promise.then((res) => {
            expect(res.ok).toBe(true);
            done();
        });
    });
});
