import { statSync, existsSync } from 'fs';
import express, { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';

import { IWebServer, TRouteType } from './defs';
import { ILogger } from '@haibun/core/src/lib/interfaces/logger';

export const DEFAULT_PORT = 8123;

export class ServerExpress implements IWebServer {
  logger: ILogger;
  static listening: boolean = false;
  listener: any;
  app = express();
  static mounted: { [named: string]: string } = {};
  base: string;
  port: number;
  constructor(logger: ILogger, base: string, port: number = DEFAULT_PORT) {
    this.logger = logger;
    this.base = base;
    this.port = port;

    this.app.use(cookieParser());
  }

  async listen(): Promise<IWebServer> {
    if (!ServerExpress.listening) {
      try {
        ServerExpress.listening = true

        this.listener = await this.app.listen(this.port, () => this.logger.log(`Server listening on port: ${this.port}`));

        this.logger.log('express listening');
      } catch (e) {
        console.error(e);
      }
    } else {
      this.logger.log('express already listening');
    }
    return this as IWebServer;
  }

  async addRoute(type: TRouteType, path: string, route: RequestHandler) {
    try {
      const alreadyMounted = this.checkMountBadOrMounted(path, route.toString());


      if (alreadyMounted) {
        this.logger.debug(`already mount ${path}`);
        return;
      }
    } catch (e: any) {
      throw (e);
    }
    this.logger.log(`serving route from ${path}`);
    await this.app[type](path, route);
    await this.addMounted(path, route.toString());
  }

  async addMounted(path: string, what: string) {
    ServerExpress.mounted[path] = what;
    if (!this.listener) {
      await this.listen();
    }
  }

  // add a static folder restricted to relative paths from files
  async addStaticFolder(relativeFolder: string, mountAt: string = '/'): Promise<string | undefined> {
    if (relativeFolder !== relativeFolder.replace(/[^a-zA-Z-0-9\/-_]/g, '').replace(/^\//g, '')) {
      throw Error(`mount folder ${relativeFolder} has illegal characters`);
    }
    const folder = [this.base, relativeFolder].join('/');
    return this.doAddStaticFolder(folder, mountAt);
  }

  // add a static folder at any path
  async addKnownStaticFolder(folder: string, mountAt: string = '/'): Promise<string | undefined> {
    return this.doAddStaticFolder(folder, mountAt);
  }

  async doAddStaticFolder(folder: string, mountAt: string = '/'): Promise<string | undefined> {
    try {
      const alreadyMounted = this.checkMountBadOrMounted(mountAt, folder);
      if (alreadyMounted) {
        // FIXME
        return;
      }
    } catch (e: any) {
      return e.message;
    }
    if (!existsSync(folder)) {
      throw Error(`"${folder}" doesn't exist`);
    }
    const stat = statSync(folder);
    if (!stat.isDirectory()) {
      throw Error(`"${folder}" is not a directory`);
    }

    this.logger.info(`serving files from ${folder} at ${mountAt}`);
    await this.app.use(mountAt, express.static(folder));
    await this.addMounted(mountAt, folder);
    return;
  }

  checkMountBadOrMounted(loc: string, what: string): boolean {
    const alreadyMounted = ServerExpress.mounted[loc];
    if (alreadyMounted === what) {
      this.logger.log(`${alreadyMounted} already mounted at ${loc}`);
      return true;
    } else if (alreadyMounted && alreadyMounted !== what) {
      throw Error(`cannot mount ${what} at ${loc}, ${alreadyMounted} is already mounted}`);
    }
    return false;
  }

  async close() {
    this.logger.info('closing server');
    await this.listener?.close();
  }
}
