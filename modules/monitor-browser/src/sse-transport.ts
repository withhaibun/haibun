import { EventEmitter } from 'events';
import { streamSSE } from 'hono/streaming';
import type { IWebServer } from '@haibun/web-server-hono/defs.js';
import type { IEventLogger } from '@haibun/core/lib/EventLogger.js';

export interface ITransport {
  send(data: unknown): void;
  onMessage(handler: (data: unknown) => void): void;
}

export class SSETransport implements ITransport {
  private hub = new EventEmitter();
  public webserver: IWebServer;
  private eventLogger: IEventLogger;
  private messageHandlers: ((data: unknown) => void)[] = [];
  private history: string[] = [];

  constructor(webserver: IWebServer, eventLogger: IEventLogger) {
    this.webserver = webserver;
    this.eventLogger = eventLogger;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.webserver.addRoute('get', '/sse', async (c) => {
      this.eventLogger.debug('SSE Client connected');
      return await streamSSE(c, async (stream) => {
        // Replay history
        for (const msg of this.history) {
          await stream.writeSSE({
            data: msg,
            event: 'message',
          });
        }

        const handler = (data: string) => {
          stream.writeSSE({ data, event: 'message' }).catch((e) => {
            this.eventLogger.error(`Error writing to SSE stream: ${e}`);
          });
        };
        this.hub.on('event', handler);

        stream.onAbort(() => {
          this.eventLogger.debug('SSE Client disconnected');
          this.hub.off('event', handler);
        });

        // Keep connection open
        while (true) {
          await stream.sleep(1000);
        }
      });
    });

    this.webserver.addRoute('post', '/sse/message', async (c) => {
      try {
        const data = await c.req.json();
        this.eventLogger.debug(`SSE Received: ${JSON.stringify(data)}`);
        this.handleMessage(data);
        return c.json({ ok: true });
      } catch (e) {
        this.eventLogger.error(`Error parsing SSE POST message: ${e}`);
        return c.json({ ok: false, error: String(e) }, 400);
      }
    });
  }

  // biome-ignore lint/suspicious/noExplicitAny: event payload
  public send(data: any) {
    // Clear history on init to prevent stale data across runs
    if (data?.type === 'init') {
      this.history = [];
    }
    const payload = JSON.stringify(data);
    this.history.push(payload);
    this.hub.emit('event', payload);
  }

  public onMessage(handler: (data: unknown) => void) {
    this.messageHandlers.push(handler);
  }

  private handleMessage(data: unknown) {
    for (const handler of this.messageHandlers) {
      handler(data);
    }
  }

  // Legacy publish alias for compatibility
  public publish(event: unknown) {
    this.send(event);
  }
}
