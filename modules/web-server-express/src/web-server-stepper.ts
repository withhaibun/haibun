import { IHasOptions, IStepper, IExtensionConstructor, OK, TWorld, TNamed, TOptions } from '@haibun/core/build/lib/defs';
import { actionNotOK } from '@haibun/core/build/lib/util';
import { IWebServer, WEBSERVER, WEBSERVER_STEPPER } from './defs';
import { ServerExpress, DEFAULT_PORT } from './server-express';

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
    // this.world.runtime[CHECK_LISTENER] = WebServerStepper.checkListener;
  }

  async finish() {
    await this.webserver?.close();
  }

  async checkListener(options: TOptions) {
    const port = options[`HAIBUN_O_${WEBSERVER_STEPPER.toUpperCase()}_PORT`] as number;
    await this.webserver!.listen();
  }

  steps = {
    isListening: {
      gwta: 'webserver is listening',
      action: async () => {
        await this.checkListener(this.world.options);
        return OK;
      },
    },
    serveFiles: {
      gwta: 'serve files from {loc}',
      action: async ({ loc }: TNamed) => {
        const ws: IWebServer = await this.world.runtime[WEBSERVER];
        await ws.listen(8123);
        const error = await ws.addStaticFolder(loc);
        this.world.shared.set('file_location', loc);

        return error === undefined ? OK : actionNotOK(error);
      },
      build: async ({ loc }: TNamed) => {
        this.world.shared.set('file_location', loc);
        return OK;
      }
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

