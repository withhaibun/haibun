import { TFeatureStep, IStepperCycles, TStepArgs } from '@haibun/core/lib/defs.js';
import { TRequestHandler } from '@haibun/web-server-express/defs.js';
import { AStepper, TStepperSteps } from '@haibun/core/lib/astepper.js';
declare class TestServer extends AStepper {
    cycles: IStepperCycles;
    toDelete: {
        [name: string]: string;
    };
    authScheme: any;
    authToken: string | undefined;
    basicAuthCreds: undefined | {
        username: string;
        password: string;
    };
    resources: {
        id: number;
        name: string;
    }[];
    endedFeatures(): Promise<void>;
    addRoute: (route: TRequestHandler, method?: "get" | "post" | "delete") => (args: TStepArgs, vstep: TFeatureStep) => Promise<import("@haibun/core/lib/defs.js").TOKActionResult | import("@haibun/core/lib/defs.js").TNotOKActionResult>;
    tally: TRequestHandler;
    download: TRequestHandler;
    upload: TRequestHandler;
    steps: TStepperSteps;
}
export default TestServer;
