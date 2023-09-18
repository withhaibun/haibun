import { OK, TNamed, TVStep, AStepper, TWorld } from '@haibun/core/build/lib/defs.js';
import { getFromRuntime } from '@haibun/core/build/lib/util/index.js';
import { IWebServer, WEBSERVER } from '@haibun/web-server-express/build/defs.js';

import { WebSocketServer as WSS, WebSocket } from 'ws';

import path from 'path';
import { TContextProcessor, WEB_SOCKET_SERVER } from '../Context.js';

export class WebSocketServer {
  wss: WSS;
  contextProcessors: { [name: string]: TContextProcessor } = {};
  logger: any = console;

  addContextProcessors(contextProcessors: { [name: string]: TContextProcessor }) {
    this.contextProcessors = {
      ...this.contextProcessors, ...contextProcessors
    }
  }
  async connection(ws: WebSocket) {
    ws.on('message', async (message: string) => {
      const parsed = JSON.parse(message)?.contexted;

      const ctx = parsed['@context'];
      const processor = this.contextProcessors[ctx];
      ws.send('something');
      if (processor !== undefined) {
        try {
          await this.contextProcessors[parsed['@context']](parsed);
        } catch (e: any) {
          console.error(e);
          this.logger.error(`failed context process ${JSON.stringify(e.message)}`, e);
        }
      } else {
        this.logger.warn(`no processor for context ${ctx} from ${message}`);
      }
    });
  }
  constructor(port: number, logger: any) {
    this.wss = new WSS({ host: '0.0.0.0', port });
    this.wss.on('connection', this.connection.bind(this));
    this.logger = logger;
  }
}

const LoggerWebSockets = class LoggerWebsockets extends AStepper {
  ws: WebSocketServer | undefined;
  async setWorld(world: TWorld) {
    this.world = world;
  }

  getWebSocketServer(port: number) {
    if (this.ws) {
      return this.ws;
    }
    this.ws = new WebSocketServer(port, this.getWorld().logger);
    this.getWorld().runtime[WEB_SOCKET_SERVER] = this.ws;
    return this.ws;
  }

  steps = {
    start: {
      gwta: 'start a websocket server at port {port}',
      action: async ({ port }: TNamed) => {
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
