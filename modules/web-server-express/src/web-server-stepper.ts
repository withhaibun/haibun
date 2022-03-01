import { IHasOptions, OK, TWorld, TNamed, TOptions, AStepper } from '@haibun/core/build/lib/defs';
import { actionNotOK, getFromRuntime, getStepperOption, intOrError } from '@haibun/core/build/lib/util';
import { IWebServer, WEBSERVER, } from './defs';
import { ServerExpress, DEFAULT_PORT } from './server-express';

const WebServerStepper = class WebServerStepper extends AStepper implements IHasOptions {
  webserver: ServerExpress | undefined;

  options = {
    PORT: {
      desc: `change web server port from ${DEFAULT_PORT}`,
      parse: (port: string) => intOrError(port)
    },
  };

  setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    // this.world.runtime[CHECK_LISTENER] = WebServerStepper.checkListener;
    const port = parseInt(getStepperOption(this, 'PORT', world.extraOptions)) || DEFAULT_PORT;
    this.webserver = new ServerExpress(world.logger, [process.cwd(), 'files'].join('/'), port);
    world.runtime[WEBSERVER] = this.webserver;
  }

  async close() {
    await this.webserver?.close();
  }

  steps = {
    isListening: {
      gwta: 'webserver is listening',
      action: async () => {
        await this.webserver!.listen();
        return OK;
      },
    },
    showMounts: {
      gwta: 'show mounts',
      action: async () => {
        const mounts = ServerExpress.mounted;
        this.getWorld().logger.info(`mounts: ${JSON.stringify(mounts)}`);
        return OK;
      },
    },
    serveFiles: {
      gwta: 'serve files from {loc}',
      action: async ({ loc }: TNamed) => {
        const ws: IWebServer = await getFromRuntime(this.getWorld().runtime, WEBSERVER);
        const error = await ws.addStaticFolder(loc);
        this.getWorld().shared.set('file_location', loc);

        return error === undefined ? OK : actionNotOK(error);
      },
      build: async ({ loc }: TNamed) => {
        this.getWorld().shared.set('file_location', loc);
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
}
