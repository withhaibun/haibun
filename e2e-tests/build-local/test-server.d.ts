import type { TFeatureStep, IStepperCycles } from "@haibun/core/lib/execution.js";
import { type TStepArgs } from "@haibun/core/schema/protocol.js";
import { type TRequestHandler } from "@haibun/web-server-hono/defs.js";
import { type TSchemeType, type AuthSchemeLogout } from "./authSchemes.js";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
declare class TestServer extends AStepper {
    cycles: IStepperCycles;
    toDelete: {
        [name: string]: string;
    };
    /** Currently active auth scheme type - set at runtime */
    currentAuthScheme?: TSchemeType;
    /** Current auth scheme handler for logout */
    authSchemeHandler?: AuthSchemeLogout;
    /** Dynamic auth middleware - created once, checks scheme at request time */
    private dynamicAuthMiddleware?;
    authToken: string | undefined;
    basicAuthCreds: undefined | {
        username: string;
        password: string;
    };
    resources: {
        id: number;
        name: string;
    }[];
    endedFeatures(): void;
    /**
     * Get or create the dynamic auth middleware.
     * This middleware checks currentAuthScheme at request time.
     */
    private getDynamicAuthMiddleware;
    /**
     * Add a route without auth middleware
     */
    addRoute: (route: TRequestHandler, method?: "get" | "post" | "delete") => (args: TStepArgs, vstep: TFeatureStep) => import("@haibun/core/schema/protocol.js").TActionResult;
    /**
     * Add a route protected by auth middleware.
     * Uses dynamic middleware that checks currentAuthScheme at request time.
     */
    addAuthRoute: (route: TRequestHandler, method?: "get" | "post" | "delete") => (args: TStepArgs, vstep: TFeatureStep) => import("@haibun/core/schema/protocol.js").TActionResult;
    tally: TRequestHandler;
    download: TRequestHandler;
    upload: TRequestHandler;
    steps: TStepperSteps;
}
export default TestServer;
//# sourceMappingURL=test-server.d.ts.map