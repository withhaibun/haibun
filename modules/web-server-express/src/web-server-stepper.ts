import { IHasOptions, OK, TWorld, TNamed, TOptions, AStepper, TFeatureStep, IStepperCycles } from '@haibun/core/build/lib/defs.js';
import { actionNotOK, getFromRuntime, getStepperOption, intOrError } from '@haibun/core/build/lib/util/index.js';
import { IWebServer, WEBSERVER } from './defs.js';
import { ServerExpress, DEFAULT_PORT } from './server-express.js';
import { WEB_PAGE } from '@haibun/core/build/lib/domain-types.js';
import path from 'path';

const cycles = (wss: WebServerStepper): IStepperCycles => ({
	async startFeature() {
		wss.webserver = new ServerExpress(wss.world.logger, path.join([process.cwd(), 'files'].join('/')), wss.port);
		wss.getWorld().runtime[WEBSERVER] = wss.webserver;
	}
});

class WebServerStepper extends AStepper implements IHasOptions {
	webserver: ServerExpress | undefined;
	cycles = cycles(this);

	options = {
		PORT: {
			desc: `change web server port from ${DEFAULT_PORT}`,
			parse: (port: string) => intOrError(port),
		},
	};
	port: number;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		// this.world.runtime[CHECK_LISTENER] = WebServerStepper.checkListener;
		this.port = parseInt(getStepperOption(this, 'PORT', world.moduleOptions)) || DEFAULT_PORT;
	}


	async endedFeature() {
		await this.webserver?.endedFeature();
		this.webserver = undefined;
	}

	steps = {
		thisURI: {
			gwta: `a ${WEB_PAGE} at {where}`,
			action: async ({ where }: TNamed, featureStep: TFeatureStep) => {
				const page = featureStep.sourceFeature.name

				const webserver = <IWebServer>getFromRuntime(this.getWorld().runtime, WEBSERVER);
				await webserver.checkAddStaticFolder(page, where);
				return OK;
			},
		},
		/// generator
		isListening: {
			gwta: 'webserver is listening',
			action: async () => {
				await this.listen();
				return OK;
			},
		},
		showMounts: {
			gwta: 'show mounts',
			action: async () => {
				const webserver = <IWebServer>getFromRuntime(this.getWorld().runtime, WEBSERVER);
				const mounts = webserver.mounted;
				this.getWorld().logger.info(`mounts: ${JSON.stringify(mounts, null, 2)}`);
				return OK;
			},
		},
		serveFilesAt: {
			gwta: 'serve files at {where} from {loc}',
			action: async ({ where, loc }: TNamed) => {
				return await this.doServeFiles(where, loc).catch((e) => actionNotOK(e));
			},
		},
		serveFiles: {
			gwta: 'serve files from {loc}',
			action: async ({ loc }: TNamed) => {
				const r = await this.doServeFiles('/', loc).catch((e) => actionNotOK(e));
				return r;
			},
		},
		indexFiles: {
			gwta: 'index files from {loc}',
			action: async ({ loc }: TNamed) => {
				const r = await this.doServeIndex('/', loc).catch((e) => actionNotOK(e));
				return r;
			},
		},
		indexFilesAt: {
			gwta: 'index files at {where} from {loc}',
			action: async ({ where, loc }: TNamed) => {
				const r = await this.doServeIndex(where, loc).catch((e) => actionNotOK(e));
				console.log('r', r);
				return r;
			},
		},
		showRoutes: {
			gwta: 'show routes',
			action: async () => {
				const routes = this.webserver?.mounted;
				this.getWorld().logger.info(`routes: ${JSON.stringify(routes, null, 2)}`);
				return OK;
			},
		}
	};
	async doServeIndex(where, loc) {
		const ws: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
		const res = ws.checkAddIndexFolder(loc, where);
		if (res) {
			return actionNotOK(`failed to add index folder ${loc} at ${where}: ${res}`);
		}
		await this.listen();
		return OK;
	}
	async doServeFiles(where, loc) {
		const ws: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
		const res = ws.checkAddStaticFolder(loc, where);
		if (res) {
			return actionNotOK(`failed to add static folder ${loc} at ${where}: ${res}`, { topics: { failure: { summary: res } } });
		}
		await this.listen();
		return OK;
	}
	async listen() {
		await this.webserver.listen();
	}
};

export default WebServerStepper;

export type ICheckListener = (options: TOptions, webserver: IWebServer) => void;
export interface IWebServerStepper {
	webserver: IWebServer;
	close: () => void;
}
