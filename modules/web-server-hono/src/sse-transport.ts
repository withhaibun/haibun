import { EventEmitter } from 'events';
import { stream } from 'hono/streaming';
import { streamSSE } from 'hono/streaming';
import type { IWebServer } from './defs.js';
import type { IEventLogger } from '@haibun/core/lib/EventLogger.js';
import { truncateForLog } from '@haibun/core/lib/util/index.js';

type TMessageHandler = (data: unknown) => unknown | Promise<unknown>;

/** Writer for streaming NDJSON chunks back over an HTTP response. */
export type TStreamWriter = (chunk: unknown) => Promise<void>;

/** Stream handler: receives the parsed request, a writer, and an abort signal. Returns true if it handled the request. */
type TStreamHandler = (data: unknown, write: TStreamWriter, signal: AbortSignal) => Promise<boolean>;

export interface ITransport {
  send(data: unknown): void;
  onMessage(handler: TMessageHandler): void;
  onStreamMessage(handler: TStreamHandler): void;
}

export const TRANSPORT = 'transport';

export class SSETransport implements ITransport {
  private hub = new EventEmitter();
  public webserver: IWebServer;
  private eventLogger: IEventLogger;
  private messageHandlers: TMessageHandler[] = [];
  private streamHandlers: TStreamHandler[] = [];
  private history: string[] = [];

  constructor(webserver: IWebServer, eventLogger: IEventLogger) {
    this.webserver = webserver;
    this.eventLogger = eventLogger;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.webserver.addRoute('get', '/sse', async (c) => {
      this.eventLogger.debug('SSE Client connected');
      return await streamSSE(c, async (sseStream) => {
        // Replay history
        for (const msg of this.history) {
          await sseStream.writeSSE({
            data: msg,
            event: 'message',
          });
        }

        const handler = (data: string) => {
          sseStream.writeSSE({ data, event: 'message' }).catch((e) => {
            this.eventLogger.error(`Error writing to SSE stream: ${e}`);
          });
        };
        this.hub.on('event', handler);

        sseStream.onAbort(() => {
          this.eventLogger.debug('SSE Client disconnected');
          this.hub.off('event', handler);
        });

        // Keep connection open
        while (true) {
          await sseStream.sleep(1000);
        }
      });
    });

    this.webserver.addRoute('post', '/rpc/:_method', async (c) => {
      try {
        const data = await c.req.json();
        const isStream = (data as Record<string, unknown>).stream === true;

        if (isStream) {
          c.header('Content-Type', 'application/x-ndjson');
          return stream(c, async (s) => {
            const abortController = new AbortController();
            s.onAbort(() => abortController.abort());
            const write: TStreamWriter = async (chunk) => {
              await s.write(new TextEncoder().encode(JSON.stringify(chunk) + '\n'));
            };
            let handled = false;
            for (const handler of this.streamHandlers) {
              handled = await handler(data, write, abortController.signal);
              if (handled) break;
            }
            if (!handled) {
              await write({ error: 'No stream handler for this method' });
            }
          });
        }

        this.eventLogger.debug(`RPC: ${JSON.stringify(truncateForLog(data))}`);
        const result = await this.handleMessage(data);
        return c.json((result ?? { ok: true }) as Record<string, unknown>);
      } catch (e) {
        this.eventLogger.error(`Error parsing RPC POST message: ${e}`);
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

  public onMessage(handler: TMessageHandler) {
    this.messageHandlers.push(handler);
  }

  public onStreamMessage(handler: TStreamHandler) {
    this.streamHandlers.push(handler);
  }

  private async handleMessage(data: unknown): Promise<unknown> {
    for (const handler of this.messageHandlers) {
      const result = await handler(data);
      if (result !== undefined) return result;
    }
    return undefined;
  }
}
