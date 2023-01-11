import LoggerWebSocketsClient from '@haibun/context/build/websocket-client/LoggerWebSocketsClient';
import { record } from './recorder';

jest.setTimeout(30000);
const onmessage = (message: MessageEvent) => {
    console.log('🤑->>', message);
}
describe('recorder', () => {
    it('should record', (done) => {
        const loggerWebSocketsClient = new LoggerWebSocketsClient(3931, { onmessage });
        const promise = record('http://localhost:8126/form.html', ['test']);
        promise.then((res) => {
            expect(res.ok).toBe(true);
            done();
        });
    });
});
