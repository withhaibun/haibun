import { OK, TNamed, TVStep, AStepper, TWorld } from '@haibun/core/build/lib/defs';
import { getFromRuntime } from '@haibun/core/build/lib/util';
import { IWebServer, WEBSERVER } from '@haibun/web-server-express/build/defs';

import WebSocket from 'ws';

import path from 'path';
// FIXME
type TWS = { on: (arg0: string, arg1: (message: any) => void) => void; send: (arg0: string) => void };
class WebSocketServer {
  buffered: any[] = [];
  wss: WebSocket.Server;
  clients: TWS[] = [];
  async connection(ws: TWS) {
    ws.on('message', (message) => {
      console.debug('received: %s', message);
      if (message === 'catchup') {
        ws.send(JSON.stringify({ catchup: this.buffered }));
        this.clients.push(ws);
      }
    });
  }
  constructor() {
    this.wss = new WebSocket.Server({ host: '0.0.0.0', port: 3294 });
    this.wss.on('connection', this.connection.bind(this));
  }
}

const LoggerWebSockets = class LoggerWebsockets extends AStepper {
  ws: WebSocketServer | undefined;
  setWorld(world: TWorld) {
    this.world = world;
  }

  getWebSocketServer() {
    if (this.ws) {
      return this.ws;
    }
    this.ws = new WebSocketServer();
    return this.ws;
  }

  steps = {
    start: {
      gwta: 'start a websocket server at {port}',
      action: async ({ port }: TNamed) => {
        const ws = this.getWebSocketServer();
        return OK;
      }

    },
    subscribe: {
      gwta: 'serve websocket log at {page}',
      action: async ({ page }: TNamed, vstep: TVStep) => {
        const webserver = <IWebServer>getFromRuntime(this.getWorld().runtime, WEBSERVER);

        webserver.addKnownStaticFolder(path.join(__dirname, '../client/dist/'), `/${page}`);

        return OK;
      },
    },
  };
};
export default LoggerWebSockets;
