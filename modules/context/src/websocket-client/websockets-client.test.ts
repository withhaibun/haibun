import { WebSocketServer } from "../websocket-server/websockets-server.js";
import LoggerWebSocketsClient from "./LoggerWebSocketsClient.js";

const PORT = 3939;
xdescribe('logger-websockets', () => {
    test('onmessage handler', async () => {
        const s = new WebSocketServer(PORT, console);
        
        let msg: string | undefined = undefined;
        const client = new LoggerWebSocketsClient(PORT, {
            onmessage: (event: MessageEvent) => {
                msg = 'bobo'
                console.info(event)
            }
        });
        await client.connect({ onError: (event: any) => { console.error(event) } });
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
