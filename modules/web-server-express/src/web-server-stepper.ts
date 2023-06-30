import { IHasOptions, OK, TWorld, TNamed, TOptions, AStepper, TVStep, } from '@haibun/core/build/lib/defs.js';
import { actionNotOK, getFromRuntime, getStepperOption, intOrError } from '@haibun/core/build/lib/util/index.js';
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
        await webserver.checkAddStaticFolder(page, where);
        return OK;
      },
    },
    /// generator
    isListening: {
      gwta: 'webserver is listening',
      action: async () => {
        await this.listen();
        return OK;
      },
    },
    showMounts: {
      gwta: 'show mounts',
      action: async () => {
        const webserver = <IWebServer>getFromRuntime(this.getWorld().runtime, WEBSERVER);
        const mounts = webserver.mounted;
        this.getWorld().logger.info(`mounts: ${JSON.stringify(mounts)}`);
        return OK;
      },
    },
    serveFilesAt: {
      gwta: 'serve files at {where} from {loc}',
      action: async ({ where, loc }: TNamed) => {
        await this.doServeFiles(where, loc).catch((e) => actionNotOK(e));
        return OK;
      },
    },
    serveFiles: {
      gwta: 'serve files from {loc}',
      action: async ({ loc }: TNamed) => {
        const r = await this.doServeFiles('/', loc).catch((e) => actionNotOK(e));
        return r;
      }
    },
    indexFiles: {
      gwta: 'index files from {loc}',
      action: async ({ loc }: TNamed) => {
        const r = await this.doServeIndex('/', loc).catch((e) => actionNotOK(e));
        return r;
      }
    },
    indexFilesAt: {
      gwta: 'index files at {where} from {loc}',
      action: async ({ where, loc }: TNamed) => {
        const r = await this.doServeIndex(where, loc).catch((e) => actionNotOK(e));
        return r;
      }
    }
  }
  async doServeIndex(where, loc) {
    const ws: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
    const res = ws.checkAddIndexFolder(loc, where);
    if (res) {
      throw Error(`failed to add index folder ${loc} at ${where}`);
    }
    await this.listen();
    return OK;
  }
  async doServeFiles(where, loc) {
    const ws: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
    const res = ws.checkAddStaticFolder(loc, where);
    if (res) {
      throw Error(`failed to add static folder ${loc} at ${where}`);
    }
    await this.listen();
    return OK;
  }
  async listen() {
    await this.webserver.listen();
  }
};
export default WebServerStepper;

export type ICheckListener = (options: TOptions, webserver: IWebServer) => void;
export interface IWebServerStepper {
  webserver: IWebServer;
  close: () => void;
}
