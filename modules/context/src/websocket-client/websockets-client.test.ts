import { WebSocketServer } from "../websocket-server/websockets-server";
import LoggerWebSocketsClient from "./LoggerWebSocketsClient";

const PORT = 3939;
describe('logger-websockets', () => {
    test('onmessage handler', async () => {
        const server = new WebSocketServer(PORT, console);
        let msg: string | undefined = undefined;
        const client = new LoggerWebSocketsClient(PORT, {
            onmessage: (event: any) => {
                msg = 'bobo'
                console.info(event)
            }
        });
        await client.connect({ onError: (event: any) => { console.error(event) } });;
        await client.waitForOpen();
        client.log('test', { '@context': 'test', test: 'test' });
        const i = setInterval(() => {
            console.log('waiting for message', msg);

            if (msg !== undefined) {
                clearInterval(i);
            }
        }, 500);
        expect(msg).toBeDefined();
    })
})
