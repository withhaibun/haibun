import { ILogOutput, TLogLevel, TMessageContext } from "@haibun/core/build/lib/interfaces/logger.js";

export class LoggerWebSocketsClient implements ILogOutput {
  socket: WebSocket;
  constructor() {
    this.socket = new WebSocket('localhost:3294');
    this.socket.onmessage = (event) => {
      console.log('e', event);
    };
  }
  out(level: TLogLevel, args: any, ctx?: TMessageContext | undefined) {
    this.socket.send({ level: JSON.stringify(level), args, ctx }.toString())
  }
}
