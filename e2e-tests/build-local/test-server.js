import { rmSync } from 'fs';
import fileUpload from 'express-fileupload';
import { actionNotOK, actionOK, getFromRuntime, sleep, asError } from '@haibun/core/lib/util/index.js';
import { DOMAIN_STRING } from "@haibun/core/lib/domain-types.js";
import { OK, Origin } from '@haibun/core/lib/defs.js';
import { WEBSERVER } from '@haibun/web-server-express/defs.js';
import { restRoutes } from './rest.js';
import { authSchemes } from './authSchemes.js';
import { EExecutionMessageType } from '@haibun/core/lib/interfaces/logger.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
const TALLY = 'tally';
const setTally = (value) => ({ term: TALLY, value: String(value), domain: DOMAIN_STRING, origin: Origin.var });
const cycles = (ts) => ({
    startFeature: async () => {
        const p = { when: `${TestServer.name}.cycles.startFeature`, seq: [0] };
        ts.getWorld().shared.set(setTally(0), p);
        ts.resources = [
            {
                id: 1,
                name: 'Ignore 1',
            },
            {
                id: 2,
                name: 'Include 2',
            },
            {
                id: 3,
                name: 'Include 3',
            },
        ];
    }
});
class TestServer extends AStepper {
    cycles = cycles(this);
    toDelete = {};
    authScheme;
    authToken;
    basicAuthCreds = {
        username: 'foo',
        password: 'bar',
    };
    resources = [];
    async endedFeatures() {
        if (Object.keys(this.toDelete).length > 0) {
            this.getWorld().logger.log(`removing ${JSON.stringify(this.toDelete)}`);
            for (const td of Object.values(this.toDelete)) {
                rmSync(td);
            }
        }
    }
    addRoute = (route, method = 'get') => {
        return async (args, vstep) => {
            const { loc } = args;
            let webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER);
            try {
                webserver.addRoute(method, loc, route);
            }
            catch (error) {
                console.error(error);
                const messageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: asError(error) };
                return actionNotOK(vstep.in, { messageContext });
            }
            return actionOK();
        };
    };
    tally = async (req, res) => {
        const cur = (parseInt(this.getWorld().shared.get(TALLY), 10) || 0) + 1;
        this.getWorld().shared.set(setTally(cur), { when: 'tally', seq: [cur] });
        this.getWorld().logger.log(`tally ${cur}`);
        const { username } = req.query;
        await sleep(Math.random() * 2000);
        res
            .status(200)
            .cookie('userid', username)
            .send(`<h1>Counter test</h1>tally: ${cur}<br />username ${username} `);
    };
    download = async (req, res) => {
        if (!this.toDelete.uploaded) {
            res.sendStatus(404);
            res.end('no file to download');
            return;
        }
        this.toDelete.downloaded = '/tmp/test-downloaded.jpg';
        res.download(this.toDelete.uploaded);
    };
    upload = async (req, res) => {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).send('No files were uploaded.');
        }
        const uploaded = req.files.upload;
        if (uploaded !== undefined) {
            const file = uploaded;
            const uploadPath = `/tmp/upload-${Date.now()}.${file.name}.uploaded`;
            file.mv(uploadPath, (err) => {
                if (err) {
                    return res.status(500).send(err);
                }
                this.toDelete.uploaded = uploadPath;
                res.send('<a id="to-download" href="/download">Uploaded file</a>');
            });
        }
    };
    steps = {
        addTallyRoute: {
            gwta: 'start tally route at {loc}',
            action: this.addRoute(this.tally),
        },
        addUploadRoute: {
            gwta: 'start upload route at {loc}',
            // Define action directly to include middleware, bypassing addRoute helper
            action: async (args, vstep) => {
                const { loc } = args;
                try {
                    const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER);
                    // Register route directly with method, location, middleware (cast to any), and handler
                    webserver.addRoute('post', loc, fileUpload(), this.upload);
                    return actionOK();
                }
                catch (error) {
                    this.getWorld().logger.error(`Error adding upload route ${loc}: ${error}`);
                    const messageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: asError(error) };
                    return actionNotOK(vstep.in, { messageContext });
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
            action: async (args, vstep) => {
                const { token } = args;
                this.authToken = token;
                return actionOK();
            },
        },
        addCheckAuthTokenRoute: {
            gwta: 'start check auth route at {loc}',
            action: this.addRoute(restRoutes(this).checkAuth),
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
            action: this.addRoute(restRoutes(this).resources),
        },
        addResourceGet: {
            gwta: 'start auth resource get route at {loc}',
            action: this.addRoute(restRoutes(this).resourceGet),
        },
        addResourceDelete: {
            gwta: 'start auth resource delete route at {loc}',
            action: this.addRoute(restRoutes(this).resourceDelete, 'delete'),
        },
        setAuthScheme: {
            gwta: 'make auth scheme {scheme}',
            action: async (args, vstep) => {
                const { scheme } = args;
                this.authScheme = authSchemes[scheme](this);
                return OK;
            },
        },
    };
}
export default TestServer;
//# sourceMappingURL=test-server.js.map