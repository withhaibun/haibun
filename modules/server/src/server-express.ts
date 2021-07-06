import { statSync, existsSync } from "fs";
const express = require("express");

import { Request, Response } from "express";
import { TLogger } from "@haibun/core/build/lib/defs";
import { Server } from "http";

export const DEFAULT_PORT = 8123;

export class ServerExpress {
  port: number;
  logger: TLogger;
  static listener: any;
  static app: any;
  static mounted: { [named: string]: string } = {};
  constructor(logger: TLogger, port: number = DEFAULT_PORT) {
    this.logger = logger;
    this.port = port;
  }

  async start() {
    if (!ServerExpress.app) {
      ServerExpress.app = express();
      this.logger.info(`starting server on port ${this.port}`);
      ServerExpress.listener = await ServerExpress.app.listen(this.port, () =>
        this.logger.log(`Server listening on port: ${this.port}`)
      );
    } else {
      this.logger.log("express already started");
    }
  }

  addRoute() {
    ServerExpress.app.get("/", (req: Request, res: Response) => {
      res.send("Hello World!");
    });
  }

  addStaticFolder(folder: string) {
    const loc = "/";
    const alreadyMounted = ServerExpress.mounted[loc];
    if (alreadyMounted === folder) {
      this.logger.log(`${alreadyMounted} already mounted at ${loc}`);
    } else if (alreadyMounted && alreadyMounted !== folder) {
      throw Error(
        `cannot mount ${folder} at ${loc}, ${alreadyMounted} is already mounted}`
      );
    }
    ServerExpress.mounted[loc] = folder;
    if (!existsSync(folder)) {
      throw Error(`server: "${folder}" doesn't exist`);
    }
    const stat = statSync(folder);
    if (!stat.isDirectory()) {
      throw Error(`server: "${folder}" is not a directory`);
    }

    this.logger.info(`serving files from ${folder} at ${loc}`);
    ServerExpress.app.use(express.static(folder));
  }
  async close() {
    this.logger.info("closing server");
    await ServerExpress.listener?.close();
  }
}
