import { IHasOptions, OK, TWorld, TNamed, TOptions, AStepper, TVStep, } from '@haibun/core/build/lib/defs.js';
import { getFromRuntime, getStepperOption, intOrError } from '@haibun/core/build/lib/util/index.js';
import { IWebServer, WEBSERVER, } from './defs.js';
import { ServerExpress, DEFAULT_PORT } from './server-express.js';
import { WEB_PAGE } from '@haibun/domain-webpage/build/domain-webpage.js';

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
    thisURI: {
      gwta: `a ${WEB_PAGE} at {where}`,
      action: async ({ where }: TNamed, vstep: TVStep) => {
        const page = vstep.source.name;

        const webserver = <IWebServer>getFromRuntime(this.getWorld().runtime, WEBSERVER);
        webserver.addStaticFolder(page, where);
        console.debug('added page', page);

        return OK;
      },
    },
    /// generator
    webpage: {
      gwta: `A ${WEB_PAGE} {name} hosted at {location}`,
      action: async ({ name, location }: TNamed, vsteps: TVStep) => {
        const page = vsteps.source.name;

        const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER);
        // TODO mount the page
        return OK;
      },
    },
    isListening: {
      gwta: 'webserver is listening',
      action: async () => {
        await this.webserver.listen();
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
    serveFilesAt: {
      gwta: 'serve files at {where} from {loc}',
      action: async ({ where, loc }: TNamed) => {
        return this.doServeFiles(where, loc);
      },
    },
    serveFiles: {
      gwta: 'serve files from {loc}',
      action: async ({ loc }: TNamed) => {
        return this.doServeFiles('/', loc);
      },
    },
  };
  doServeFiles(where, loc) {
    const ws: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
    ws.addStaticFolder(loc, where);
    // this.getWorld().shared.set('file_location', loc);
    return OK;
  }
};
export default WebServerStepper;

export type ICheckListener = (options: TOptions, webserver: IWebServer) => void;
export interface IWebServerStepper {
  webserver: IWebServer;
  close: () => void;
}
