import { statSync, existsSync } from "fs";
const express = require("express");

import { Request, Response } from "express";
import { TLogger } from "@haibun/core/build/lib/defs";
import { hasUncaughtExceptionCaptureCallback } from "process";

export class ServerApp {
  port: number;
  logger: TLogger;
  listener: any;
  app: any;
  constructor(logger: TLogger, port: number = 8123) {
    this.app = express();
    this.logger = logger;
    this.port = port;
  }

  async start() {
    this.logger.info(`starting server on port ${this.port}`);
    this.listener = await this.app.listen(this.port, () =>
      this.logger.log(`Server listening on port: ${this.port}`)
    );
  }

  addRoute() {
    this.app.get("/", (req: Request, res: Response) => {
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
    this.app.use(express.static(loc));
  }
  async stop() {
    this.logger.info("closing server");
    await this.listener?.close();
  }
}
