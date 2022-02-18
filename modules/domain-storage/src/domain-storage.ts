import { WorkspaceContext } from '@haibun/core/build/lib/contexts';
import { IHasDomains, TNamed, TVStep, OK, AStepper, TFromDomain, TFileTypeDomain, IHasOptions } from '@haibun/core/build/lib/defs';
import { getFromRuntime, stringOrError } from '@haibun/core/build/lib/util';

export const STORAGE_LOCATION = 'STORAGE_LOCATION';
export const STORAGE_ITEM = 'STORAGE_ITEM';

export const storageLocation: TFileTypeDomain = {
  name: STORAGE_LOCATION, fileType: STORAGE_LOCATION, is: 'string', validate: (content: string) => {
    return undefined;
  }
};

export interface IStorage {
  setLocation(location: string): string;
}

export const storageItem: TFromDomain = { name: STORAGE_ITEM, from: STORAGE_LOCATION, is: 'string' };

const DomainWebPage = class DomainWebPage extends AStepper implements IHasDomains, IHasOptions {
  domains = [
    storageLocation,
    storageItem,
  ];
  locator = (location: string) => `http://localhost:8123/${location}`;
  options = {
    BASE_DIRECTORY: {
      desc: 'run browsers without a window (true or false)',
      parse: (input: string) => stringOrError(input)
    }
  }
  steps = {
    aLocation: {
      gwta: `a ${STORAGE_LOCATION} at {where}`,
      action: async ({ where }: TNamed, vstep: TVStep) => {
        const location = vstep.source.name;

        const webserver = <IStorage>getFromRuntime(this.getWorld().runtime, 'storage');
        webserver.setLocation(location);
        return OK;
      },
    },
    anItem: {
      gwta: `A ${STORAGE_ITEM} {name}`,
      action: async ({ name }: TNamed) => {
        return OK;
      },
      build: async ({ name }: TNamed, a: TVStep, workspace: WorkspaceContext) => {
        workspace.getBuilder().addControl(name);
        return { ...OK };
      },
    },
  };
};
export default DomainWebPage;