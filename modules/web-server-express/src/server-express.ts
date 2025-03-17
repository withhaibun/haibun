import { statSync, existsSync } from 'fs';
import http from 'http';
import express, { RequestHandler } from 'express';
import serveIndex from 'serve-index';
import cookieParser from 'cookie-parser';

import { IWebServer, ROUTE_TYPES, TRequestHandler, TRouteMap, TRouteTypes, TStaticFolderOptions } from './defs.js';
import { ILogger } from '@haibun/core/build/lib/interfaces/logger.js';

export const DEFAULT_PORT = 8123;
const defaultMounted = () => ROUTE_TYPES.reduce((acc, type) => ({ ...acc, [type]: {} }), <TRouteMap>{});

export class ServerExpress implements IWebServer {
	static listening = false;
	listener?: http.Server;
	app = express();
	mounted = defaultMounted();
	constructor(private logger: ILogger, private base: string, private port: number = DEFAULT_PORT) {
		this.app.use(cookieParser());
		this.app.use(express.json({ limit: '150mb' }));
		this.app.use(express.urlencoded({ extended: true }));
		this.app.use(express.text());
		this.app.disable('x-powered-by');
	}

	use(middleware: RequestHandler) {
		this.app.use(middleware);
	}

	listen() {
		return new Promise((resolve, reject) => {
			if (!ServerExpress.listening) {
				try {
					this.listener = this.app.listen(this.port, () => {
						this.logger.log(`Server listening on port: ${this.port}`);
						ServerExpress.listening = true;
						this.logger.log('express listening');
						resolve('started');
					});
				} catch (e) {
					reject(e);
				}
			} else {
				this.logger.log('express already listening');
				resolve('already listening');
			}
		});
	}

	addRoute(type: TRouteTypes, path: string, ...routes: RequestHandler[]) {
		if (type !== 'get' && type !== 'post' && type !== 'put' && type !== 'delete' && type !== 'head') {
			throw Error(`invalid route type ${type}`);
		}
		const bad = this.checkMountBadOrMounted('get', path, routes.toString());
		if (bad) {
			throw Error(bad);
		}

		this.logger.log(`adding ${type} route from ${path}`);
		this.app[type](path, ...routes);

		this.addMounted(type, path, routes.toString());
	}

	addKnownRoute(type: TRouteTypes, path: string, ...routes: TRequestHandler[]) {
		this.logger.log(`adding known ${type} route from ${path}`);
		this.app[type](path, ...routes);
		this.addMounted(type, path, routes.toString());
	}

	private addMounted(type: string, path: string, what: string) {
		this.mounted[type][path] = what;
	}

	// add a static folder restricted to relative paths from files
	checkAddStaticFolder(relativeFolder: string, mountAt = '/', options?: TStaticFolderOptions) {
		const folder = [this.base, relativeFolder].join('/');
		return this.doAddStaticFolder(folder, mountAt, options);
	}

	// add a index folder restricted to relative paths from files
	checkAddIndexFolder(relativeFolder: string, mountAt = '/', options?: TStaticFolderOptions) {
		const folder = [this.base, relativeFolder].join('/');
		const bad = this.checkMountBadOrMounted('get', folder, mountAt);
		if (bad) {
			return bad;
		}
		this.logger.info(`serving index from ${folder} at ${mountAt}`);
		this.app.use(mountAt, serveIndex(folder), express.static(folder, options));
		return;
	}

	// add a static folder at any path
	addKnownStaticFolder(folder: string, mountAt = '/', options?: TStaticFolderOptions) {
		return this.doAddStaticFolder(folder, mountAt, options);
	}

	private doAddStaticFolder(folder: string, mountAt = '/', options: TStaticFolderOptions = {}) {
		const bad = this.checkMountBadOrMounted('get', mountAt, folder);
		if (bad) {
			return bad;
		}
		if (!existsSync(folder)) {
			return `"${folder}" doesn't exist`;
		}
		const stat = statSync(folder);
		if (!stat.isDirectory()) {
			return `"${folder}" is not a directory`;
		}

		this.app.use(mountAt, express.static(folder, options));
		this.addMounted('get', mountAt, folder);
		this.logger.info(`serving files from ${folder} at ${mountAt}`);
		return;
	}

	checkMountBadOrMounted(type: string, loc: string, what: string) {
		if (loc !== loc.replace(/[^a-zA-Z-0-9/\-_]/g, '')) {
			return `mount folder ${loc} has illegal characters`;
		}
		const alreadyMounted =
			this.mounted[type][loc] || Object.keys(this.mounted[type]).find((m: string) => m.startsWith(`${loc}/`));
		if (alreadyMounted) {
			return `cannot mount ${type} ${what} at ${loc}, ${alreadyMounted} is already mounted}`;
		}
		return undefined;
	}

	async endedFeatures() {
		this.logger.debug(`closing server ${this.port}`);
		await this.listener?.close();
		this.mounted = defaultMounted();
		ServerExpress.listening = false;
	}
}
