import { WorkspaceContext } from '@haibun/core/build/lib/contexts';
import { IExtensionConstructor, IStepper, IHasDomains, TWorld, TNamed, TVStep, OK } from '@haibun/core/build/lib/defs';
import { getFromRuntime } from '@haibun/core/build/lib/util';
import { getDomain } from '@haibun/core/build/lib/domain';
import { WebPageBuilder } from './WebPageBuilder';
import { IWebServer } from '@haibun/core/build/lib/interfaces/webserver';

export const webPage = 'webpage';
export const webControl = 'webcontrol';

const DomainWebPage: IExtensionConstructor = class DomainWebPage implements IStepper, IHasDomains {
  domains = [
    { name: webPage, fileType: webPage, is: 'string', validate: this.validatePage },
    { name: webControl, from: webPage, is: 'string' },
  ];
  locator = (location: string) => `http://localhost:8123/${location}`;
  world: TWorld;

  constructor(world: TWorld) {
    this.world = world;
  }
  validatePage(content: string) {
    return undefined;
  }
  steps = {
    thisURI: {
      gwta: `a ${webPage} at {where}`,
      action: async ({ where }: TNamed, vstep: TVStep) => {
        const page = vstep.source.name;

        const webserver = <IWebServer>getFromRuntime(this.world.runtime, 'webserver');
        webserver.addStaticFolder(page);
        console.log('added paeg', page);
        
        return OK;
      },
    },
    /// generator
    webpage: {
      gwta: `A ${webPage} {name} hosted at {location}`,
      action: async ({ name, location }: TNamed, vsteps: TVStep) => {
        const page = vsteps.source.name;

        const webserver = getFromRuntime(this.world.runtime, 'webserver');
        // TODO mount the page
        return OK;
      },
      build: async ({ location }: TNamed, { source }: TVStep, workspace: WorkspaceContext) => {
        if (location !== location.replace(/[^a-zA-Z-0-9\.]/g, '')) {
          throw Error(`${webPage} location ${location} has millegal characters`);
        }
        const subdir = this.world.shared.get('file_location');
        if (!subdir) {
          throw Error(`must declare a file_location`);
        }
        const folder = `files/${subdir}`;
        workspace.addBuilder(new WebPageBuilder(source.name, this.world.logger, location, folder));
        return { ...OK, finalize: this.finalize };
      },
    },
    webcontrol: {
      gwta: `A ${webControl} {name}`,
      action: async ({ name }: TNamed) => {
        return OK;
      },
      build: async ({ name }: TNamed, a: TVStep, workspace: WorkspaceContext) => {
        workspace.getBuilder().addControl(name);
        return { ...OK };
      },
    },
  };
  finalize = (workspace: WorkspaceContext) => {
    if (workspace.get('_finalized')) {
      return;
    }
    workspace.set('_finalized', true);
    const builder = workspace.getBuilder();

    const shared = builder.finalize();
    const domain = getDomain(webPage, this.world)!.shared.get(builder.name);

    for (const [name, val] of shared) {
      domain.set(name, val);
    }
  };
};
export default DomainWebPage;
