import { IStepper, IExtensionConstructor, OK, TWorld } from '@haibun/core/build/lib/defs';
import { TLogLevel } from '@haibun/core/build/lib/interfaces/logger';
import { getFromRuntime } from '@haibun/core/build/lib/util';
import { IWebServer } from '@haibun/core/build/lib/interfaces/webserver';

import WebSocket from 'ws';
import { ISubscriber } from '@haibun/core/build/lib/interfaces/logger';

class WebSocketServer implements ISubscriber {
  wss: typeof WebSocket;
  clients: any[] = [];
  connection(ws) {
    this.clients.push(ws);
    console.log('client', ws);

    ws.on('message', function incoming(message) {
      console.log('received: %s', message);
    });
    ws.send('something');
  }
  constructor() {
    this.wss = new WebSocket.Server({ port: 7071 });
    this.wss.on('connection', this.connection.bind(this));
  }
  out(level: TLogLevel, message: any) {
    console.log('hihii', level, message);
  }
}

const LoggerWebsockets: IExtensionConstructor = class LoggerWebsockets implements IStepper {
  world: TWorld;
  ws: typeof WebSocket.Server;

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
      gwta: 'serve websocket log',
      action: async () => {
        const webserver = <IWebServer>getFromRuntime(this.world.runtime, 'webserver');
        webserver.addStaticFolder('ws');

        return OK;
      },
    },
  };
};
export default LoggerWebsockets;
