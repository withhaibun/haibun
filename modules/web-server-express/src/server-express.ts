import { statSync, existsSync } from 'fs';
import http from 'http';
import express, { RequestHandler } from 'express';
import serveIndex from 'serve-index';
import cookieParser from 'cookie-parser';

import { IWebServer, ROUTE_TYPES, TRequestHandler, TRouteMap, TRouteTypes, TStaticFolderOptions } from './defs.js';
import { IEventLogger } from '@haibun/core/lib/EventLogger.js';

export const DEFAULT_PORT = 8123;
const defaultMounted = () => ROUTE_TYPES.reduce((acc, type) => ({ ...acc, [type]: {} }), <TRouteMap>{});

export class ServerExpress implements IWebServer {
	static listening: number[] = [];
	listener?: http.Server;
	app = express();
	mounted = defaultMounted();
	constructor(private logger: IEventLogger, private base: string, private port: number = DEFAULT_PORT) {
		this.app.use(cookieParser());
		this.app.use(express.json({ limit: '150mb' }));
		this.app.use(express.urlencoded({ extended: true }));
		this.app.use(express.text());
		this.app.disable('x-powered-by');
	}

	use(middleware: RequestHandler) {
		this.app.use(middleware);
	}

	listen(port = this.port) {
		return new Promise((resolve, reject) => {
			if (!ServerExpress.listening.includes(port)) {
				try {
					this.listener = this.app.listen(port, () => {
						this.logger.debug(`Server listening on port: ${port}`);
						ServerExpress.listening.push(port);
						this.logger.debug(`express listening on ports ${ServerExpress.listening}`);
						resolve('started');
					});
				} catch (e) {
					reject(e);
				}
			} else {
				this.logger.info('express already listening');
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

		this.logger.debug(`adding ${type} route from ${path}`);
		this.app[type](path, ...routes);

		this.addMounted(type, path, routes.toString());
	}

	addKnownRoute(type: TRouteTypes, path: string, ...routes: TRequestHandler[]) {
		this.logger.debug(`adding known ${type} route from ${path}`);
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
		this.logger.debug(`serving index from ${folder} at ${mountAt}`);
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
		this.logger.debug(`serving files from ${folder} at ${mountAt}`);
		return;
	}

	checkMountBadOrMounted(type: string, loc: string, what: string) {
		// accepts valid characters and placeholders
		const sanitized = loc.replace(/[^a-zA-Z0-9/\-:_]/g, '').replace(/:(?![a-zA-Z0-9_-])/g, '')
		if (loc !== sanitized) {
			return `mount folder ${loc} has illegal characters`;
		}
		const alreadyMounted =
			this.mounted[type][loc] || Object.keys(this.mounted[type]).find((m: string) => m.startsWith(`${loc}/`));
		if (alreadyMounted) {
			return `cannot mount ${type} ${what} at ${loc}, ${alreadyMounted} is already mounted}`;
		}
		return undefined;
	}

	async close(port = this.port) {
		this.logger.debug(`closing server ${port}`);
		await this.listener?.close();
		this.mounted = defaultMounted();
		ServerExpress.listening = ServerExpress.listening.filter(p => p !== port);
	}
}
