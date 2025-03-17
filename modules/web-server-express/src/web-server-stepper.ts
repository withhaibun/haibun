import { IHasOptions, OK, TWorld, TNamed, TOptions, AStepper, TFeatureStep } from '@haibun/core/build/lib/defs.js';
import { actionNotOK, getFromRuntime, getStepperOption, intOrError } from '@haibun/core/build/lib/util/index.js';
import { IWebServer, WEBSERVER } from './defs.js';
import { ServerExpress, DEFAULT_PORT } from './server-express.js';
import { WEB_PAGE } from '@haibun/core/build/lib/domain-types.js';
import path from 'path';

const WebServerStepper = class WebServerStepper extends AStepper implements IHasOptions {
	webserver: ServerExpress | undefined;

	options = {
		PORT: {
			desc: `change web server port from ${DEFAULT_PORT}`,
			parse: (port: string) => intOrError(port),
		},
	};

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		// this.world.runtime[CHECK_LISTENER] = WebServerStepper.checkListener;
		const port = parseInt(getStepperOption(this, 'PORT', world.moduleOptions)) || DEFAULT_PORT;
		this.webserver = new ServerExpress(world.logger, path.join([process.cwd(), 'files'].join('/')), port);
		world.runtime[WEBSERVER] = this.webserver;
	}

	async endedFeature() {
		await this.webserver?.endedFeatures();
	}

	steps = {
		thisURI: {
			gwta: `a ${WEB_PAGE} at {where}`,
			action: async ({ where }: TNamed, featureStep: TFeatureStep) => {
				const page = featureStep.source.name;

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
