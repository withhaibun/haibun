import { TLogger, TShared } from '@haibun/core/build/lib/defs';
import { writeFileSync } from 'fs';

export class WebPageBuilder {
  controls: string[];
  location: string;
  logger: TLogger;
  shared: TShared;
  path: string;

  constructor(path: string, logger: TLogger, location: string) {
    this.path = path;
    this.logger = logger;
    this.location = location;
    this.controls = [];
    this.shared = { [path]: `http://localhost:8080/${location}` };
  }
  addControl(type: string) {
    this.controls.push(type);
    this.shared[type] = 'boo';
  }
  finalize() {
    const dest = `files/${this.location}.html`;
    this.logger.log(`writing to ${dest}`);
    writeFileSync(dest, this.controls.join('<br />\n'));
    return this.shared;
  }
}
