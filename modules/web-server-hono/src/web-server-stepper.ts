import path from 'path';

import type { TWorld, TEndFeature, IStepperCycles } from '@haibun/core/lib/defs.js';
import { OK, type TStepArgs } from '@haibun/core/schema/protocol.js';
import { actionNotOK, getFromRuntime, getStepperOption, intOrError } from '@haibun/core/lib/util/index.js';
import { AStepper, type IHasCycles, type IHasOptions } from '@haibun/core/lib/astepper.js';

import { type IWebServer, WEBSERVER } from './defs.js';
import { ServerHono, DEFAULT_PORT } from './server-hono.js';

const cycles = (wss: WebServerStepper): IStepperCycles => ({
  async startFeature() {
    const filesBase = path.join(process.cwd(), 'files');
    wss.webserver = new ServerHono(wss.world.eventLogger, filesBase);
    wss.getWorld().runtime[WEBSERVER] = wss.webserver;
    await Promise.resolve();
  },
  async endFeature({ shouldClose = true }: TEndFeature) {
    if (shouldClose) {
      await wss.webserver?.close();
      wss.webserver = undefined;
    }
  },
});

class WebServerStepper extends AStepper implements IHasOptions, IHasCycles {
  webserver: ServerHono | undefined;
  cycles: IStepperCycles = cycles(this);

  options = {
    PORT: {
      desc: `Change web server port from ${DEFAULT_PORT}`,
      parse: (port: string) => intOrError(port),
    },
  };
  port: number = DEFAULT_PORT;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    const sname = this.constructor.name;
    const fromModule = world.moduleOptions?.[sname]?.['PORT'];
    const portOption = fromModule || getStepperOption(this, 'PORT', world.moduleOptions);
    if (portOption) {
      const parsed = parseInt(portOption, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`WebServerStepper: PORT option "${portOption}" must be a positive integer`);
      }
      this.port = parsed;
    }
  }

  steps = {
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
        const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
        const mounts = webserver.mounted;
        this.getWorld().eventLogger.info(`mounts: ${JSON.stringify(mounts, null, 2)}`, { mounts });
        return Promise.resolve(OK);
      },
    },
    serveFilesAt: {
      gwta: 'serve files at {where} from {loc}',
      action: async ({ where, loc }: TStepArgs) => {
        try {
          this.webserver?.checkAddStaticFolder(String(loc), String(where));
          await this.listen();
          return OK;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return actionNotOK(message);
        }
      },
    },
    serveFiles: {
      gwta: 'serve files from {loc}',
      action: async ({ loc }: TStepArgs) => {
        try {
          this.webserver?.checkAddStaticFolder(String(loc), '/');
          await this.listen();
          return OK;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return actionNotOK(message);
        }
      },
    },
    indexFiles: {
      gwta: 'index files from {loc}',
      action: async ({ loc }: TStepArgs) => {
        try {
          this.webserver?.checkAddIndexFolder(String(loc), '/');
          await this.listen();
          return OK;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return actionNotOK(message);
        }
      },
    },
    indexFilesAt: {
      gwta: 'index files at {where} from {loc}',
      action: async ({ where, loc }: TStepArgs) => {
        try {
          this.webserver?.checkAddIndexFolder(String(loc), String(where));
          await this.listen();
          return OK;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return actionNotOK(message);
        }
      },
    },
    showRoutes: {
      gwta: 'show routes',
      action: async () => {
        const routes = this.webserver?.mounted;
        this.getWorld().eventLogger.info(`routes: ${JSON.stringify(routes, null, 2)}`, { routes });
        return Promise.resolve(OK);
      },
    },
  };

  async listen() {
    if (!this.webserver) {
      throw new Error('WebServerStepper: webserver not initialized - ensure startFeature cycle ran');
    }
    await this.webserver.listen(this.port);
    console.warn(`WebServerStepper listening on ${this.port}`);
  }
}

export default WebServerStepper;

export interface IWebServerStepper {
  webserver: IWebServer;
  close: () => void;
}
