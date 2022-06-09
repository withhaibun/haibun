import { IHasOptions, OK, TWorld, TNamed, TOptions, AStepper, TVStep, IHasBuilder } from '@haibun/core/build/lib/defs';
import { actionNotOK, getFromRuntime, getStepperOption, intOrError } from '@haibun/core/build/lib/util';
import { WorkspaceContext } from '@haibun/core/src/lib/contexts';
import { IWebServer, WEBSERVER, } from './defs';
import { ServerExpress, DEFAULT_PORT } from './server-express';
import { WebPageBuilder } from '@haibun/domain-webpage/build/WebPageBuilder';
import { WEB_PAGE } from '@haibun/domain-webpage/build/domain-webpage';
import { getDomain } from '@haibun/core/src/lib/domain';

const WebServerStepper = class WebServerStepper extends AStepper implements IHasOptions, IHasBuilder {
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
        webserver.addStaticFolder(page);
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
      build: async ({ location }: TNamed, { source }: TVStep, workspace: WorkspaceContext) => {
        if (location !== location.replace(/[^a-zA-Z-0-9\.]/g, '')) {
          throw Error(`${WEB_PAGE} location ${location} has millegal characters`);
        }
        const subdir = this.getWorld().shared.get('file_location');
        if (!subdir) {
          throw Error(`must declare a file_location`);
        }
        const folder = `files/${subdir}`;
        workspace.addBuilder(new WebPageBuilder(source.name, this.getWorld().logger, location, folder));
        return { ...OK, finalize: this.finalize };
      },
    },
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
  finalize = (workspace: WorkspaceContext) => {
    if (workspace.get('_finalized')) {
      return;
    }
    workspace.set('_finalized', true);
    const builder = workspace.getBuilder();

    const shared = builder.finalize();
    const domain = getDomain(WEB_PAGE, this.getWorld())!.shared.get(builder.name);

    for (const [name, val] of shared) {
      domain.set(name, val);
    }
  };
};
export default WebServerStepper;

export type ICheckListener = (options: TOptions, webserver: IWebServer) => void;
export interface IWebServerStepper {
  webserver: IWebServer;
  close: () => void;
}
