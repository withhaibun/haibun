import { rmSync } from 'fs';
import fileUpload from 'express-fileupload';

import { actionNotOK, actionOK, getFromRuntime, sleep, asError } from '@haibun/core/lib/util/index.js';

import { DOMAIN_STRING } from "@haibun/core/lib/domain-types.js";
import { TFeatureStep, OK, IStepperCycles, Origin, TStepArgs, TProvenanceIdentifier } from '@haibun/core/lib/defs.js';
import { TRequestHandler, IRequest, IResponse, IWebServer, WEBSERVER } from '@haibun/web-server-express/defs.js';
import { restRoutes } from './rest.js';
import { authSchemes, TSchemeType } from './authSchemes.js';
import { EExecutionMessageType, TMessageContext } from '@haibun/core/lib/interfaces/logger.js';
import { AStepper, TStepperSteps } from '@haibun/core/lib/astepper.js';

const TALLY = 'tally';

const setTally = (value: number) => ({ term: TALLY, value: String(value), domain: DOMAIN_STRING, origin: Origin.var });

const cycles = (ts: TestServer): IStepperCycles => ({
	startFeature: async () => {
		const p: TProvenanceIdentifier = { when: `${TestServer.name}.cycles.startFeature`, seq: [0] }
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
		]
	}
});

class TestServer extends AStepper {
	cycles = cycles(this);
	toDelete: { [name: string]: string } = {};
	authScheme: any;

	authToken: string | undefined;

	basicAuthCreds: undefined | { username: string; password: string } = {
		username: 'foo',
		password: 'bar',
	};

	resources: { id: number; name: string }[] = [];

	async endedFeatures() {
		if (Object.keys(this.toDelete).length > 0) {
			this.getWorld().logger.log(`removing ${JSON.stringify(this.toDelete)}`);
			for (const td of Object.values(this.toDelete)) {
				rmSync(td);
			}
		}
	}
	addRoute = (route: TRequestHandler, method: 'get' | 'post' | 'delete' = 'get') => {
		return async (args: TStepArgs, vstep: TFeatureStep) => {
			const { loc } = args as { loc: string };
			let webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);

			try {
				webserver.addRoute(method, loc!, route);
			} catch (error) {
				console.error(error);
				const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: asError(error) }
				return actionNotOK(vstep.in, { messageContext });
			}
			return actionOK();
		};
	};

	tally: TRequestHandler = async (req: IRequest, res: IResponse) => {
		const cur = (parseInt(this.getWorld().shared.get(TALLY) as string, 10) || 0) + 1;
		this.getWorld().shared.set(setTally(cur), { when: 'tally', seq: [cur] });
		this.getWorld().logger.log(`tally ${cur}`);
		const { username } = req.query;
		await sleep(Math.random() * 2000);
		res
			.status(200)
			.cookie('userid', username)
			.send(`<h1>Counter test</h1>tally: ${cur}<br />username ${username} `);
	};

	download: TRequestHandler = async (req: IRequest, res: IResponse) => {
		if (!this.toDelete.uploaded) {
			res.sendStatus(404);
			res.end('no file to download');
			return;
		}

		this.toDelete.downloaded = '/tmp/test-downloaded.jpg';
		res.download(this.toDelete.uploaded);
	};
	upload: TRequestHandler = async (req: IRequest, res: IResponse) => {
		if (!req.files || Object.keys(req.files).length === 0) {
			return res.status(400).send('No files were uploaded.');
		}

		const uploaded = req.files.upload;
		if (uploaded !== undefined) {
			const file = <fileUpload.UploadedFile>uploaded;
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
	steps: TStepperSteps = {
		addTallyRoute: {
			gwta: 'start tally route at {loc}',
			action: this.addRoute(this.tally),
		},
		addUploadRoute: {
			gwta: 'start upload route at {loc}',
			// Define action directly to include middleware, bypassing addRoute helper
			action: async (args: TStepArgs, vstep: TFeatureStep) => {
				const { loc } = args as { loc: string };
				try {
					const webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
					// Register route directly with method, location, middleware (cast to any), and handler
					webserver.addRoute('post', loc!, fileUpload() as any, this.upload);
					return actionOK();
				} catch (error) {
					this.getWorld().logger.error(`Error adding upload route ${loc}: ${error}`);
					const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: asError(error) }
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
			action: async (args: TStepArgs, vstep: TFeatureStep) => {
				const { token } = args as { token: string };
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
			action: async (args: TStepArgs, vstep: TFeatureStep) => {
				const { scheme } = args as { scheme: string };
				this.authScheme = authSchemes[<TSchemeType>scheme](this);
				return OK;
			},
		},
	};
}

export default TestServer;


