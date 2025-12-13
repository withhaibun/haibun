
import { TPrompt, TPromptResponse } from '@haibun/core/lib/prompter.js';
import { THaibunEvent } from '@haibun/core/lib/EventLogger.js';
import { RawData, WebSocket, WebSocketServer } from 'ws';

export interface ITransport {
  send(data: unknown): void;
  onMessage(handler: (data: unknown) => void): void;
}

export class WebSocketTransport implements ITransport {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        console.warn(`\n[MonitorBrowser] Warning: Port ${port} is already in use. Monitor server could not start.`);
        console.warn(`[MonitorBrowser] Events will not be streamed to browser.`);
      } else {
        console.error('[MonitorBrowser] WebSocket Server Error:', e);
      }
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      // Replay history
      for (const msg of this.history) {
        ws.send(msg);
      }
      ws.on('close', () => this.clients.delete(ws));
      ws.on('message', (data) => this.handleMessage(data));
    });
    console.log(`WebSocket server started on port ${port}`);
  }

  private history: string[] = [];

  send(data: unknown) {
    const payload = JSON.stringify(data);
    this.history.push(payload);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private messageHandlers: ((data: unknown) => void)[] = [];

  onMessage(handler: (data: unknown) => void) {
    this.messageHandlers.push(handler);
  }

  private handleMessage(data: RawData) {
    if (this.messageHandlers.length > 0) {
      try {
        const parsed = JSON.parse(data.toString());
        for (const handler of this.messageHandlers) {
          handler(parsed);
        }
      } catch (e) {
        console.error('Failed to parse message', e);
      }
    }
  }
}
