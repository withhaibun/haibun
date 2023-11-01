import { OK, TNamed, TVStep, AStepper, TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { TLogLevel, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { getFromRuntime } from '@haibun/core/build/lib/util/index.js';
import { IWebServer, WEBSERVER } from '@haibun/web-server-express/build/defs.js';

import WebSocket from 'ws';
import { ILogOutput } from '@haibun/core/build/lib/interfaces/logger.js';

import path from 'path';
// FIXME
type TWS = { on: (arg0: string, arg1: (message: TAnyFixme) => void) => void; send: (arg0: string) => void };
class WebSocketServer implements ILogOutput {
  buffered: TAnyFixme[] = [];
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
    this.wss = new WebSocket.Server({ host: '0.0.0.0', port: 7071 });
    this.wss.on('connection', this.connection.bind(this));
  }
  out(level: TLogLevel, message: TAnyFixme, mctx?: TMessageContext) {
    const content = { message, level, mctx };
    console.error('fixme; topic changed to context');

    this.buffered.push(content);
    for (const client of this.clients) {
      client.send(JSON.stringify(content));
    }
  }
}

const LoggerWebsockets = class LoggerWebsockets extends AStepper {
  ws: WebSocketServer | undefined;

  getWebSocketServer() {
    if (this.ws) {
      return this.ws;
    }
    this.ws = new WebSocketServer();
    return this.ws;
  }

  steps = {
    log: {
      gwta: 'log to websockets',
      action: async () => {
        const wss = this.getWebSocketServer();
        this.getWorld().logger.addSubscriber(wss);
        return OK;
      },
    },
    subscribe: {
      gwta: 'serve websocket log at {page}',
      action: async ({ page }: TNamed, vstep: TVStep) => {
        const webserver = <IWebServer>getFromRuntime(this.getWorld().runtime, WEBSERVER);

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
