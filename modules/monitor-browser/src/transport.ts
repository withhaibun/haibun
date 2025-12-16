
import { TPrompt, TPromptResponse } from '@haibun/core/lib/prompter.js';
import { THaibunEvent } from '@haibun/core/lib/EventLogger.js';
import { RawData, WebSocket, WebSocketServer } from 'ws';

export interface ITransport {
  send(data: unknown): void;
  onMessage(handler: (data: unknown) => void): void;
}

import http from 'http';
import fs from 'fs';
import path from 'path';

export class WebSocketTransport implements ITransport {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private server: http.Server;

  constructor(port: number, captureRoot?: string) {
    this.server = http.createServer((req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
      }

      if (req.method === 'GET' && captureRoot) {
        try {
          const urlPath = req.url?.split('?')[0] || '/';
          // Sanitize path prevents directory traversal
          const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
          const filePath = path.join(captureRoot, safePath);

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes: { [key: string]: string } = {
              '.html': 'text/html',
              '.js': 'text/javascript',
              '.css': 'text/css',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.gif': 'image/gif',
              '.svg': 'image/svg+xml',
              '.json': 'application/json',
              '.webp': 'image/webp'
            };

            const contentType = mimeTypes[ext] || 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        } catch (e) {
          console.error('Error serving file:', e);
          res.statusCode = 500;
          res.end('Internal Server Error');
          return;
        }
      }

      res.statusCode = 404;
      res.end('Not Found');
    });

    this.server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        console.warn(`\n[MonitorBrowser] Warning: Port ${port} is already in use. Monitor server could not start.`);
        console.warn(`[MonitorBrowser] Events will not be streamed to browser.`);
      } else {
        console.error('[MonitorBrowser] Server Error:', e);
      }
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.server.listen(port, () => {
      console.log(`[MonitorBrowser] Server started on port ${port} serving ${captureRoot || 'nothing'}`);
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
