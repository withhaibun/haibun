import { WorkspaceContext } from '@haibun/core/build/lib/contexts';
import { IHasDomains, TNamed, TVStep, OK, AStepper, TFromDomain, TFileTypeDomain, IHasBuilder } from '@haibun/core/build/lib/defs';
import { getFromRuntime } from '@haibun/core/build/lib/util';
import { getDomain } from '@haibun/core/build/lib/domain';
import { WebPageBuilder } from './WebPageBuilder';
import { IWebServer, WEBSERVER } from '@haibun/web-server-express/build/defs';

export const WEB_PAGE = 'webpage';
export const WEB_CONTROL = 'webcontrol';

export const webPage: TFileTypeDomain = {
  name: WEB_PAGE, fileType: WEB_PAGE, is: 'string', validate: (content: string) => {
    return undefined;
  }
};

export const webControl: TFromDomain = { name: WEB_CONTROL, from: WEB_PAGE, is: 'string' };

const DomainWebPage = class DomainWebPage extends AStepper implements IHasDomains, IHasBuilder {
  domains = [
    webPage,
    webControl,
  ];
  locator = (location: string) => `http://localhost:8123/${location}`;

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
    webcontrol: {
      gwta: `A ${WEB_CONTROL} {name}`,
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
    const domain = getDomain(WEB_PAGE, this.getWorld())!.shared.get(builder.name);

    for (const [name, val] of shared) {
      domain.set(name, val);
    }
  };
};
export default DomainWebPage;
