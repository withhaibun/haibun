import { IStepper, IExtensionConstructor, OK, TWorld, TNamed, TVStep } from '@haibun/core/build/lib/defs';
import { TLogLevel, TMessageContext } from '@haibun/core/build/lib/interfaces/logger';
import { getFromRuntime } from '@haibun/core/build/lib/util';
import { IWebServer } from '@haibun/core/build/lib/interfaces/webserver';

import WebSocket from 'ws';
import { ILogOutput } from '@haibun/core/build/lib/interfaces/logger';

import path from 'path';
// FIXME
type TWS = { on: (arg0: string, arg1: (message: any) => void) => void; send: (arg0: string) => void };
class WebSocketServer implements ILogOutput {
  buffered: any[] = [];
  wss: WebSocket.Server;
  clients: TWS[] = [];
  async connection(ws: TWS) {
    ws.on('message', (message) => {
      console.log('received: %s', message);
      if (message === 'catchup') {
        ws.send(JSON.stringify({ catchup: this.buffered }));
        this.clients.push(ws);
      }
    });
  }
  constructor() {
    this.wss = new WebSocket.Server({ host: '0.0.0.0', port: 7071 });
    this.wss.on('connection', this.connection.bind(this));
  }
  out(level: TLogLevel, message: any, mctx?: TMessageContext) {
    const content = { message, level, mctx };
    console.error('fixme; topic changed to context');

    this.buffered.push(content);
    for (const client of this.clients) {
      client.send(JSON.stringify(content));
    }
  }
}

const LoggerWebsockets: IExtensionConstructor = class LoggerWebsockets implements IStepper {
  world: TWorld;
  ws: WebSocketServer | undefined;

  getWebSocketServer() {
    if (this.ws) {
      return this.ws;
    }
    this.ws = new WebSocketServer();
    return this.ws;
  }

  constructor(world: TWorld) {
    this.world = world;
  }

  steps = {
    log: {
      gwta: 'log to websockets',
      action: async () => {
        const wss = this.getWebSocketServer();
        this.world.logger.addSubscriber(wss);
        return OK;
      },
    },
    subscribe: {
      gwta: 'serve websocket log at {page}',
      action: async ({ page }: TNamed, vstep: TVStep) => {
        const webserver = <IWebServer>getFromRuntime(this.world.runtime, 'webserver');

        webserver.addKnownStaticFolder(path.join(__dirname, '../client/dist/'), `/${page}`);

        return OK;
      },
    },
    waitForUpload: {
      gwta: 'wait for {name} upload',
      action: async ({ page }: TNamed, vstep: TVStep) => {
        return OK;
      },
    },
  };
};
export default LoggerWebsockets;
