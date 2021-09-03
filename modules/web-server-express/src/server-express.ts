import { statSync, existsSync } from 'fs';
import express, { RequestHandler } from 'express';

import { IWebServer, TRouteType } from '@haibun/core/build/lib/interfaces/webserver';
import { TLogger } from '@haibun/core/src/lib/interfaces/logger';

export const DEFAULT_PORT = 8123;

export class ServerExpress implements IWebServer {
  logger: TLogger;
  static listener: any;
  static app = express();
  static mounted: { [named: string]: string } = {};
  base: string;
  constructor(logger: TLogger, base: string, port: number = DEFAULT_PORT) {
    this.logger = logger;
    this.base = base;
  }

  async listening(port: number) {
    if (!ServerExpress.listener) {
      ServerExpress.listener = await ServerExpress.app.listen(port, () => this.logger.log(`Server listening on port: ${port}`));
    } else {
      this.logger.log('express already started');
    }
  }

  async addRoute(type: TRouteType, path: string, route: RequestHandler) {
    try {
      const alreadyMounted = this.checkMountBadOrMounted(path, route.toString());
      if (alreadyMounted) {
        return;
      }
    } catch (e: any) {
      return e.message;
    }
    this.logger.log(`serving route from ${path}`);

    await ServerExpress.app[type](path, route);
  }

  async addStaticFolder(subdir: string): Promise<string | undefined> {
    const folder = [this.base, subdir].join('/');
    const loc = '/';
    try {
      const alreadyMounted = this.checkMountBadOrMounted(loc, folder);
      if (alreadyMounted) {
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

    ServerExpress.mounted[loc] = folder;
    this.logger.info(`serving files from ${folder} at ${loc}`);
    await ServerExpress.app.use(express.static(folder));
    return;
  }

  checkMountBadOrMounted(loc: string, what: string): boolean {
    if (!ServerExpress.listener) {
      throw Error(`listening must be called before mount`);
    }
    if (!loc) {
      throw Error(`missing mount location`);
    }

    if (loc !== loc.replace(/[^a-zA-Z-0-9\/]/g, '')) {
      throw Error(`mount folder ${loc} has illegal characters`);
    }
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
    await ServerExpress.listener?.close();
  }
}
