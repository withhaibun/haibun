import {
  IHasOptions,
  IStepper,
  IExtensionConstructor,
  OK,
  TWorld,
  TKeyString,
} from "@haibun/core/build/lib/defs";
import { ServerExpress, DEFAULT_PORT } from "./server-express";

const WebServer: IExtensionConstructor = class WebServer
  implements IStepper, IHasOptions
{
  webserver: ServerExpress | undefined;
  world: TWorld;

  options = {
    PORT: {
      desc: `change web server port from ${DEFAULT_PORT}`,
      parse: (port: string) => parseInt(port, 10),
    },
  };
  constructor(world: TWorld) {
    this.world = world;
  }

  async getWebServer() {
    if (!this.webserver) {
      this.webserver = new ServerExpress(this.world.logger);
      await this.webserver!.start();
    }
    return this.webserver!;
  }

  close() {
    this.webserver?.close();
  }

  steps = {
    serveFiles: {
      gwta: "serve files from {loc}",
      action: async ({ loc }: TKeyString) => {
        const folder = [
          process.cwd(),
          "files",
          loc.replace(/[^a-zA-Z-]/g, ""),
        ].join("/");
        const ws = await this.getWebServer();
        
        ws.addStaticFolder(folder);
        return OK;
      },
    },
  };
};
export default WebServer;
