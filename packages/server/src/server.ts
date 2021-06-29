const express = require('express');

import { Request, Response } from 'express';
import { TLogger } from '@haibun/core/build/lib/defs';

const app = express();

export class HaibunServer {
  port: number;
  logger: TLogger;
  constructor(logger: TLogger, port: number) {
    this.logger = logger;
    this.port = port;
  }

  start() {
    app.listen(this.port, () => this.logger.log(`Server listening on port: ${this.port}`));

    app.use(express.static('public'));
  }

  addRoute() {
    app.get('/', (req: Request, res: Response) => {
      res.send('Hello World!');
    });
  }

  addFiles(loc: string) {
    app.use(express.static('public'));
  }
}
