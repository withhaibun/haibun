import { OK, TNamed, TVStep, AStepper, TWorld } from '@haibun/core/build/lib/defs';
import { getFromRuntime } from '@haibun/core/build/lib/util';
import { IWebServer, WEBSERVER } from '@haibun/web-server-express/build/defs';

import WebSocket from 'ws';

import path from 'path';
import { TContextProcessor, WEB_SOCKET_SERVER } from '../Context';

class WebSocketServer {
  wss: WebSocket.Server;
  contextProcessors: { [name: string]: TContextProcessor } = {};
  addContextProcessors(contextProcessors: { [name: string]: TContextProcessor }) {
    this.contextProcessors = {
      ...this.contextProcessors, ...contextProcessors
    }
  }
  async connection(ws: WebSocket) {
    ws.on('message', (message: string) => {
      console.debug('received: %s', message, JSON.parse(message));
    });
  }
  constructor(port: number) {
    this.wss = new WebSocket.Server({ host: '0.0.0.0', port });
    this.wss.on('connection', this.connection.bind(this));
  }
}

const LoggerWebSockets = class LoggerWebsockets extends AStepper {
  ws: WebSocketServer | undefined;
  setWorld(world: TWorld) {
    this.world = world;
  }

  getWebSocketServer(port: number) {
    console.log('p', port);
    if (this.ws) {
      return this.ws;
    }
    this.ws = new WebSocketServer(port);
    this.getWorld().runtime[WEB_SOCKET_SERVER] = this.ws;
    return this.ws;
  }

  steps = {
    start: {
      gwta: 'start a websocket server at port {port}',
      action: async ({ port }: TNamed) => {
        console.log(`port "${port}"`, port, parseInt(port, 10));

        const ws = this.getWebSocketServer(parseInt(port, 10));
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
