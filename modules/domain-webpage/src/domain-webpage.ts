import { WorkspaceContext } from '@haibun/core/build/lib/contexts';
import { IHasDomains, TNamed, TVStep, OK, AStepper, TFromDomain, TFileTypeDomain } from '@haibun/core/build/lib/defs';

export const WEB_PAGE = 'webpage';
export const WEB_CONTROL = 'webcontrol';
export const SELECTOR = 'selector';

export const webPage: TFileTypeDomain = {
  name: WEB_PAGE, fileType: WEB_PAGE, is: 'string', validate: (content: string) => {
    return undefined;
  }
};

export const webControl: TFromDomain = { name: WEB_CONTROL, from: WEB_PAGE, is: 'string' };

const DomainWebPage = class DomainWebPage extends AStepper implements IHasDomains {
  domains = [
    webPage,
    webControl,
  ];
  locator = (location: string) => `http://localhost:8123/${location}`;

  steps = {
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
};
export default DomainWebPage;
