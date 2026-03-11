import { rmSync, writeFileSync, readFileSync } from 'fs';
import { setCookie } from '@haibun/web-server-hono/cookie.js';
import { actionNotOK, actionOK, getFromRuntime, sleep } from '@haibun/core/lib/util/index.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';
import { OK, Origin } from '@haibun/core/schema/protocol.js';
import { WEBSERVER } from '@haibun/web-server-hono/defs.js';
import { restRoutes } from './rest.js';
import { createDynamicAuthMiddleware, authSchemes } from './authSchemes.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
const TALLY = 'tally';
const setTally = (value) => ({
    term: TALLY,
    value: String(value),
    domain: DOMAIN_STRING,
    origin: Origin.var,
});
const cycles = (ts) => ({
    startFeature: async () => {
        const p = { when: `${TestServer.name}.cycles.startFeature`, seq: [0] };
        ts.getWorld().shared.set(setTally(0), p);
        ts.resources = [
            { id: 1, name: 'Ignore 1' },
            { id: 2, name: 'Include 2' },
            { id: 3, name: 'Include 3' },
        ];
        // Reset auth state for each feature
        ts.currentAuthScheme = undefined;
        ts.authSchemeHandler = undefined;
    },
});
class TestServer extends AStepper {
    cycles = cycles(this);
    toDelete = {};
    /** Currently active auth scheme type - set at runtime */
    currentAuthScheme;
    /** Current auth scheme handler for logout */
    authSchemeHandler;
    /** Dynamic auth middleware - created once, checks scheme at request time */
    dynamicAuthMiddleware;
    authToken;
    basicAuthCreds = {
        username: 'foo',
        password: 'bar',
    };
    resources = [];
    async endedFeatures() {
        if (Object.keys(this.toDelete).length > 0) {
            this.getWorld().eventLogger.info(`removing ${JSON.stringify(this.toDelete)}`);
            for (const td of Object.values(this.toDelete)) {
                rmSync(td);
            }
        }
    }
    /**
     * Get or create the dynamic auth middleware.
     * This middleware checks currentAuthScheme at request time.
     */
    getDynamicAuthMiddleware() {
        if (!this.dynamicAuthMiddleware) {
            this.dynamicAuthMiddleware = createDynamicAuthMiddleware(this);
        }
        return this.dynamicAuthMiddleware;
    }
    /**
     * Add a route without auth middleware
     */
    addRoute = (route, method = 'get') => {
        return async (args, vstep) => {
            const { loc } = args;
            const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER);
            try {
                webserver.addRoute(method, loc, route);
            }
            catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.getWorld().eventLogger.error(`addRoute failed: ${err.message}`);
                return actionNotOK(`${vstep.in}: ${err.message}`);
            }
            return actionOK();
        };
    };
    /**
     * Add a route protected by auth middleware.
     * Uses dynamic middleware that checks currentAuthScheme at request time.
     */
    addAuthRoute = (route, method = 'get') => {
        return async (args, vstep) => {
            const { loc } = args;
            const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER);
            try {
                // Apply dynamic auth middleware that checks scheme at request time
                webserver.app.use(loc, this.getDynamicAuthMiddleware());
                webserver.addKnownRoute(method, loc, route);
            }
            catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.getWorld().eventLogger.error(`addAuthRoute failed: ${err.message}`);
                return actionNotOK(`${vstep.in}: ${err.message}`);
            }
            return actionOK();
        };
    };
    tally = async (c) => {
        const cur = (parseInt(this.getWorld().shared.resolveVariable({ term: TALLY, origin: Origin.var }, undefined, undefined, { secure: true }).value, 10) || 0) + 1;
        this.getWorld().shared.set(setTally(cur), { when: 'tally', seq: [cur] });
        this.getWorld().eventLogger.info(`tally ${cur}`);
        const username = c.req.query('username');
        await sleep(Math.random() * 2000);
        setCookie(c, 'userid', String(username));
        return c.html(`<h1>Counter test</h1>tally: ${cur}<br />username ${username} `);
    };
    download = async (c) => {
        if (!this.toDelete.uploaded) {
            return c.text('no file to download', 404);
        }
        this.toDelete.downloaded = '/tmp/test-downloaded.jpg';
        const fileBuffer = readFileSync(this.toDelete.uploaded);
        const filename = this.toDelete.uploaded.split('/').pop() ?? 'download';
        return new Response(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    };
    upload = async (c) => {
        const body = await c.req.parseBody();
        const uploaded = body['upload'];
        if (!uploaded || !(uploaded instanceof File)) {
            return c.text('No files were uploaded.', 400);
        }
        const uploadPath = `/tmp/upload-${Date.now()}.${uploaded.name}.uploaded`;
        const buffer = await uploaded.arrayBuffer();
        writeFileSync(uploadPath, Buffer.from(buffer));
        this.toDelete.uploaded = uploadPath;
        return c.html('<a id="to-download" href="/download">Uploaded file</a>');
    };
    steps = {
        addTallyRoute: {
            gwta: 'start tally route at {loc}',
            action: this.addRoute(this.tally),
        },
        addUploadRoute: {
            gwta: 'start upload route at {loc}',
            action: async (args, vstep) => {
                const { loc } = args;
                try {
                    const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER);
                    webserver.addRoute('post', loc, this.upload);
                    return actionOK();
                }
                catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    this.getWorld().eventLogger.error(`Error adding upload route ${loc}: ${err.message}`);
                    return actionNotOK(`${vstep.in}: ${err.message}`);
                }
            },
        },
        addDownloadRoute: {
            gwta: 'start download route at {loc}',
            action: this.addRoute(this.download),
        },
        addCreateAuthTokenRoute: {
            gwta: 'start create auth token route at {loc}',
            action: this.addRoute(restRoutes(this).createAuthToken),
        },
        changeServerAuthToken: {
            gwta: 'change server auth token to {token}',
            action: async (args, _vstep) => {
                const { token } = args;
                this.authToken = token;
                return actionOK();
            },
        },
        // Protected routes - use dynamic auth middleware
        addCheckAuthTokenRoute: {
            gwta: 'start check auth route at {loc}',
            action: this.addAuthRoute(restRoutes(this).checkAuth),
        },
        addLogin: {
            gwta: 'start auth login route at {loc}',
            action: this.addRoute(restRoutes(this).logIn, 'post'),
        },
        addLogoutRoute: {
            gwta: 'start logout auth route at {loc}',
            action: this.addRoute(restRoutes(this).logOut),
        },
        addResources: {
            gwta: 'start auth resources get route at {loc}',
            action: this.addAuthRoute(restRoutes(this).resources),
        },
        addResourceGet: {
            gwta: 'start auth resource get route at {loc}',
            action: this.addAuthRoute(restRoutes(this).resourceGet),
        },
        addResourceDelete: {
            gwta: 'start auth resource delete route at {loc}',
            action: this.addAuthRoute(restRoutes(this).resourceDelete, 'delete'),
        },
        setAuthScheme: {
            gwta: 'make auth scheme {scheme}',
            action: async (args, _vstep) => {
                const { scheme } = args;
                // Set the current scheme - this is checked at request time by dynamic middleware
                this.currentAuthScheme = scheme;
                this.authSchemeHandler = authSchemes[scheme](this);
                return OK;
            },
        },
    };
}
export default TestServer;
//# sourceMappingURL=test-server.js.map