
export interface TContextPublisher {
  send: (msg: TWithContext) => Promise<void>;
  close: () => Promise<void>;
}

export type TWithContext = {
  '@context': {
    [field: string]: any;
  };
  '@id'?: string;
};

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
