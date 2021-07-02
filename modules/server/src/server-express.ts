import { statSync, existsSync } from "fs";
const express = require("express");

import { Request, Response } from "express";
import { TLogger } from "@haibun/core/build/lib/defs";
import { Server } from "http";

export const DEFAULT_PORT = 8123;

export class ServerExpress {
  port: number;
  logger: TLogger;
  listener: any;
  static app: any;
  constructor(logger: TLogger, port: number = DEFAULT_PORT) {
    this.logger = logger;
    this.port = port;
  }

  async start() {
    if (!ServerExpress.app) {
      ServerExpress.app = express();
      this.logger.info(`starting server on port ${this.port}`);
      this.listener = await ServerExpress.app.listen(this.port, () =>
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

  addStaticFolder(loc: string) {
    if (!existsSync(loc)) {
      throw Error(`server: "${loc}" doesn't exist`);
    }
    const stat = statSync(loc);
    if (!stat.isDirectory()) {
      throw Error(`server: "${loc}" is not a directory`);
    }

    this.logger.info(`serving files from ${loc}`);
    ServerExpress.app.use(express.static(loc));
  }
  async close() {
    this.logger.info("closing server");
    await this.listener?.close();
  }
}
