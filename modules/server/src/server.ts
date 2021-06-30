import {
  IHasOptions,
  IStepper,
  IExtensionConstructor,
  OK,
  TResult,
  TWorld,
  TKeyString,
} from "@haibun/core/build/lib/defs";

import { ServerApp } from "./app";

const WebServer: IExtensionConstructor = class WebServer
  implements IStepper, IHasOptions
{
  async getApp() {
    if (!this.app) {
      this.app = new ServerApp(this.world.logger);
      await this.app.start();
    }
    return this.app;
  }
  options = {
    PORT: {
      desc: "change web server port",
      parse: (port: string) => parseInt(port, 10),
    },
  };
  app: ServerApp | undefined;
  world: TWorld;

  constructor(world: TWorld) {
    this.world = world;
  }
  close() {
    this.app?.stop();
  }

  steps = {
    serveFiles: {
      gwta: "serve files from (?<loc>.+)",
      action: async ({ loc }: TKeyString) => {
        const folder = [process.cwd(), 'files', loc.replace(/[^a-zA-Z-]/g, '')].join('/');
        const app = await this.getApp();
        app.addStaticFolder(folder);
        return OK;
      },
    },
  };
};
export default WebServer;
