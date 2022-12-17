import { ILoggerKeepAlive } from "@haibun/core/src/lib/interfaces/logger";
import { TWithContext } from "../Context";

// FIXME should use ConnectedLogger, etc

const defaultMessageHandler = (event: MessageEvent) => {
  console.log('socket.onmessage', event);
};
export default class LoggerWebSocketsClient {
  port: number;
  socket?: WebSocket;
  keepAlive?: ILoggerKeepAlive;
  constructor(port: number = 3294, { keepAlive }: { keepAlive?: ILoggerKeepAlive, onmessage?: (event: MessageEvent) => void }) {
    this.port = port;
    this.keepAlive = keepAlive;
  }
  async connect(errorHandler: (event: any) => void | undefined) {
    this.socket = new WebSocket(`ws://localhost:${this.port}`);
    this.socket.onerror = errorHandler;
    (this.socket.onmessage as any) = onmessage || defaultMessageHandler;
    await this.keepAlive?.start();
  }
  async disconnect() {
  }
  log(args: any, message: TWithContext) {
    this.out('log', args, { ...message, ctime: new Date().getTime() });
  }

  out(level: any, args: any, contexted: TWithContext & { ctime: number; }) {
    this.socket?.send(JSON.stringify({ level: JSON.stringify(level), contexted }));
  };
}
