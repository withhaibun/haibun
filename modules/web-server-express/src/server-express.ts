import { statSync, existsSync } from 'fs';
import http from 'http';

import express, { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';

import { IWebServer, TRouteTypes } from './defs.js';
import { ILogger } from '@haibun/core/build/lib/interfaces/logger.js';

export const DEFAULT_PORT = 8123;

export class ServerExpress implements IWebServer {
  logger: ILogger;
  static listening = false;
  listener?: http.Server;
  app = express();
  static mounted = { get: {}, post: {} };
  base: string;
  port: number;
  constructor(logger: ILogger, base: string, port: number = DEFAULT_PORT) {
    this.logger = logger;
    this.base = base;
    this.port = port;

    this.app.use(cookieParser());
    this.app.use(express.json({ limit: '50mb' }));
  }

  use(middleware: RequestHandler) {
    this.app.use(middleware);
  }

  listen() {
    return new Promise((resolve, reject) => {
      if (!ServerExpress.listening) {
        try {
          this.listener = this.app.listen(this.port, () => {
            this.logger.log(`Server listening on port: ${this.port}`)
            ServerExpress.listening = true
            this.logger.log('express listening');
            resolve('started');
          });
        } catch (e) {
          console.error(e);
          reject(e);
        }
      } else {
        this.logger.log('express already listening');
        resolve('already listening');
      }
    });
  }

  async addRoute(type: TRouteTypes, path: string, route: RequestHandler) {
    if (type !== 'get' && type !== 'post') {
      throw Error(`invalid route type ${type}`);
    }
    this.checkMountBadOrMounted(type, path, route.toString());

    this.logger.log(`adding ${type} route from ${path}`);
    this.app[type](path, route);

    await this.addMounted(type, path, route.toString());
  }

  private async addMounted(type: string, path: string, what: string) {
    ServerExpress.mounted[type][path] = what;

    if (!this.listener) {
      await this.listen();
    }
  }

  // add a static folder restricted to relative paths from files
  async addStaticFolder(relativeFolder: string, mountAt = '/') {
    const folder = [this.base, relativeFolder].join('/');
    await this.doAddStaticFolder(folder, mountAt);
  }

  // add a static folder at any path
  async addKnownStaticFolder(folder: string, mountAt = '/') {
    await this.doAddStaticFolder(folder, mountAt);
  }

  private async doAddStaticFolder(folder: string, mountAt = '/') {
    this.checkMountBadOrMounted('get', mountAt, folder);
    if (!existsSync(folder)) {
      throw Error(`"${folder}" doesn't exist`);
    }
    const stat = statSync(folder);
    if (!stat.isDirectory()) {
      throw Error(`"${folder}" is not a directory`);
    }

    this.app.use(mountAt, express.static(folder));
    await this.addMounted('get', mountAt, folder);
    this.logger.info(`serving files from ${folder} at ${mountAt}`);
    return;
  }

  checkMountBadOrMounted(type: string, loc: string, what: string) {
    if (loc !== loc.replace(/[^a-zA-Z-0-9/-_]/g, '')) {
      throw Error(`mount folder ${loc} has illegal characters`);
    }
    const alreadyMounted = ServerExpress.mounted[type][loc] || Object.keys(ServerExpress.mounted[type]).find((m: string) => m.startsWith(`${loc}/`));
    if (alreadyMounted) {
      throw Error(`cannot mount ${type} ${what} at ${loc}, ${alreadyMounted} is already mounted}`);
    }
  }

  async close() {
    this.logger.info('closing server');
    this.listener?.close();
    ServerExpress.mounted = { get: {}, post: {} };
    ServerExpress.listening = false;
  }
}
