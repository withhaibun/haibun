import { IHasOptions, IStepper, IExtensionConstructor, OK, TWorld, TKeyString, TOptions } from '@haibun/core/build/lib/defs';
import { actionNotOK } from '@haibun/core/src/lib/util';
import { RequestHandler } from 'express';
import { ServerExpress, DEFAULT_PORT } from './server-express';

export const WEBSERVER = 'webserver';
export const WEBSERVER_STEPPER = 'WebServerStepper';
export const CHECK_LISTENER = 'CHECK_LISTENER';

const WebServerStepper: IExtensionConstructor = class WebServerStepper implements IStepper, IHasOptions {
  webserver: ServerExpress | undefined;
  world: TWorld;

  options = {
    PORT: {
      desc: `change web server port from ${DEFAULT_PORT}`,
      parse: (port: string) => parseInt(port, 10),
    },
  };
  constructor(world: TWorld) {
    this.world = world;
    this.webserver = new ServerExpress(this.world.logger, [process.cwd(), 'files'].join('/'));
    this.world.runtime[WEBSERVER] = this.webserver;
    this.world.runtime[CHECK_LISTENER] = WebServerStepper.checkListener;
  }

  async close() {
    await this.webserver?.close();
  }

  static async checkListener(options: TOptions, webserver: IWebServer) {
    const port = options[`HAIBUN_O_${WEBSERVER_STEPPER.toUpperCase()}_PORT`] as number;
    await webserver.listening(port || DEFAULT_PORT);
  }

  steps = {
    serveFiles: {
      gwta: 'serve files from {loc}',
      action: async ({ loc }: TKeyString) => {
        await WebServerStepper.checkListener(this.world.options, this.world.runtime[WEBSERVER]);
        const ws: IWebServer = await this.world.runtime[WEBSERVER];
        const error = await ws.addStaticFolder(loc);

        return error === undefined ? OK : actionNotOK(error);
      },
    },
  };
};
export default WebServerStepper;

export type ICheckListener = (options: TOptions, webserver: IWebServer) => void;
export interface IWebServerStepper {
  webserver: IWebServer;
  close: () => void;
  checkListener: ICheckListener;
}

export interface IWebServer {
  addStaticFolder(subdir: string): Promise<string | undefined>;
  listening(port: number): void;
  addRoute(type: TRouteType, path: string, route: RequestHandler): void;
}

export type TRouteType = 'get';
