import { TWithContext } from "../Context";
import { ExtensionKeepAlive } from "./ExtensionKeepAlive";

// FIXME should use ConnectedLogger, etc

export class LoggerWebSocketsClient {
  port: number;
  socket?: WebSocket;
  keepAlive?: ExtensionKeepAlive;
  constructor(port: number = 3294, keepAlive?: ExtensionKeepAlive) {
    this.port = port;
    this.keepAlive = keepAlive;
  }
  async connect(errorHandler: (event: any) => void | undefined) {
    this.socket = new WebSocket(`ws://localhost:${this.port}`);
    this.socket.onerror = errorHandler;
    this.socket.onmessage = (event) => {
      console.log('socket.onmessage', event);
    };
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
