import { WebSocketServer, WebSocket } from 'ws';

export class WSServer {
    private wss: WebSocketServer;

    constructor(private port: number) {
        this.wss = new WebSocketServer({ port });
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('Client connected');
            ws.on('close', () => {
                console.log('Client disconnected');
            });
        });
    }

    broadcast(message: string) {
        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
}
