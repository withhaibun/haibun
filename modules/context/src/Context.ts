
export interface TContextPublisher {
  send: (msg: TWithContext) => Promise<void>;
  close: () => Promise<void>;
}

export type TWithContextObject = {
  '@context': {
    [field: string]: any;
  };
  '@id'?: string;
};

export type TWithContextAddress = {
  '@context': string,
  '@id'?: string;
};

export type TWithContext = TWithContextObject | TWithContextAddress;

export class WebsocketPublisher implements TContextPublisher {
  connection?: WebSocket;
  connect() {
    this.connection = new WebSocket('ws://localhost:3140');
  }
  async send(msg: TWithContext) {
    if (!this.connection) {
      this.connect();
    }
    this.connection?.send(JSON.stringify(msg));
  }
  async close() {
    this.connection?.close();
  }
}

export type TContextProcessor = (msg: TWithContext) => Promise<void>;
export type TContextProcessors = { [name: string]: TContextProcessor };
export interface IWebServer {
  addStaticFolder(subdir: string): Promise<string | undefined>;
}
export interface IWebSocketServer {
  addContextProcessors(cp: TContextProcessors): void;
}

export const WEB_SOCKET_SERVER = 'WebSocketServer'