import { get, type ClientRequest } from 'node:http';

export class McpClient {
  private messageUrl: string | null = null;
  private accessToken: string | null = null;
  private controller: AbortController;
  private baseUrl: string = '';
  private req: ClientRequest | null = null;
  private pendingRequests: Map<number | string, { resolve: (value: unknown) => void, reject: (reason?: unknown) => void }> = new Map();

  constructor(accessToken?: string) {
    this.accessToken = accessToken || null;
    this.controller = new AbortController();
  }

  async connect(url: string): Promise<void> {
    this.baseUrl = new URL(url).origin;
    console.log(`Connecting to ${url}`);
    const headers: Record<string, string> = { 'Accept': 'text/event-stream' };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    return new Promise((resolve, reject) => {
      this.req = get(url, { headers }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to connect: ${res.statusCode} ${res.statusMessage}`));
          return;
        }

        res.setEncoding('utf8');
        let buffer = '';
        let currentEvent: string | null = null;

        res.on('data', (chunk) => {
          console.log('RAW CHUNK:', chunk);
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            console.log('SSE LINE:', trimmed);
            if (!trimmed) {
              currentEvent = null;
              continue;
            }
            if (trimmed.startsWith('event: ')) {
              currentEvent = trimmed.substring(7).trim();
            } else if (trimmed.startsWith('data: ')) {
              const data = trimmed.substring(6).trim();
              if (currentEvent === 'endpoint') {
                let url = data;
                if (url.startsWith('/')) {
                  url = `${this.baseUrl}${url}`;
                }
                this.messageUrl = url;
                resolve();
              } else if (currentEvent === 'message') {
                try {
                  const msg = JSON.parse(data);
                  if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                    const { resolve, reject } = this.pendingRequests.get(msg.id)!;
                    this.pendingRequests.delete(msg.id);
                    if (msg.error) {
                      reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                      resolve(msg.result);
                    }
                  }
                } catch (e) {
                  console.error('Failed to parse message data', e);
                }
              }
            }
          }
        });

        res.on('end', () => {
          console.log('SSE stream ended');
        });
      });

      this.req.on('error', (e: Error) => {
        console.error('Stream processing error:', e);
        // Only reject if we haven't resolved yet (not ideal but works for simple test)
        // For now, relies on timeout if connection fails late
      });

      // Abort after 5 seconds if not connected
      setTimeout(() => {
        if (!this.messageUrl) {
          this.req.destroy();
          reject(new Error('Timeout waiting for endpoint event'));
        }
      }, 5000);
    });
  }

  async initialize(clientInfo: { name: string, version: string }) {
    return this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo
    });
  }

  async listTools() {
    return this.sendRequest('tools/list', {});
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  private async sendRequest(method: string, params: Record<string, unknown>) {
    if (!this.messageUrl) throw new Error('Not connected');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    const id = Math.floor(Math.random() * 10000);

    return new Promise(async (resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      try {
        const response = await fetch(this.messageUrl!, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params
          })
        });

        if (!response.ok) {
          this.pendingRequests.delete(id);
          reject(new Error(`Post failed: ${response.statusText}`));
        }
        // Response body is likely "ok" or ignored for SSE
      } catch (e) {
        this.pendingRequests.delete(id);
        reject(e);
      }
    });
  }

  close() {
    if (this.req) {
      this.req.destroy();
    }
  }
}
