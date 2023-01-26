import WebSocket from 'ws';

import { ILoggerKeepAlive } from "@haibun/core/build/lib/interfaces/logger.js";
import { TWithContext } from "../Context.js";

// FIXME should use ConnectedLogger, etc

const defaultMessageHandler = (event: MessageEvent) => {
  // console.log('socket.onmessage', event);
};
export default class LoggerWebSocketsClient {
  port: number;
  socket?: WebSocket;
  keepAlive?: ILoggerKeepAlive;
  onmessage: (event: MessageEvent<any>) => void;
  open = false;

  constructor(port = 3294, args?: { keepAlive?: ILoggerKeepAlive, onmessage?: (event: MessageEvent) => void }) {
    this.port = port;
    this.keepAlive = args?.keepAlive;
    this.onmessage = args?.onmessage || defaultMessageHandler;
  }
  async connect(args: { onError?: (event: any) => void | undefined }) {
    this.socket = new WebSocket(`ws://localhost:${this.port}`);
    if (args?.onError) this.socket.onerror = args.onError;
    this.socket.onopen = () => this.open = true;
    this.socket.onclose = () => this.open = false;
    (this.socket.onmessage as any) = this.onmessage;
    // console.log('onmessage', this.socket.onmessage);
    await this.keepAlive?.start();
  }
  waitForOpen() {
    return new Promise((resolve, reject) => {
      const i = setInterval(() => {
        if (this.open) {
          clearInterval(i);
          resolve(true);
        }
      }, 500);
    });
  }

  async disconnect() {
    this.socket?.close();
  }
  log(args: any, message: TWithContext) {
    this.out('log', args, { ...message, ctime: new Date().getTime() });
  }

  out(level: any, args: any, contexted: TWithContext & { ctime: number; }) {
    this.socket?.send(JSON.stringify({ level: JSON.stringify(level), contexted }));
  }
}
