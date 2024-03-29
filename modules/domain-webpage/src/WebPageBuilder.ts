import { writeFileSync } from 'fs';

import { DomainContext } from '@haibun/core/build/lib/contexts.js'
import { WorkspaceBuilder } from '@haibun/core/build/lib/defs.js';
import { ILogger } from '@haibun/core/build/lib/interfaces/logger.js';

export class WebPageBuilder extends WorkspaceBuilder {
  controls: string[];
  location: string;
  logger: ILogger;
  building: DomainContext;
  folder: string;

  constructor(name: string, logger: ILogger, location: string, folder: string) {
    super(name);
    this.logger = logger;
    this.location = location;
    this.controls = [];
    this.folder = folder;
    this.building = new DomainContext(`builder ${location}`);
    this.building.setId(`http://localhost:8123/${location}`);
  }
  addControl(type: string) {
    this.controls.push(type);
    this.building.set(type, 'boo');
  }
  finalize() {
    const dest = `${this.folder}/${this.location}`;
    this.logger.log(`writing to ${dest}`);
    writeFileSync(dest, this.controls.join('<br />\n'));
    return this.building;
  }
}
