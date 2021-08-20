import { DomainContext } from '@haibun/core/build/lib/contexts';
import { TLogger, WorkspaceBuilder } from '@haibun/core/build/lib/defs';
import { writeFileSync } from 'fs';

export class WebPageBuilder implements WorkspaceBuilder {
  controls: string[];
  location: string;
  logger: TLogger;
  building: DomainContext;
  path: string;

  constructor(path: string, logger: TLogger, location: string) {
    this.path = path;
    this.logger = logger;
    this.location = location;
    this.controls = [];
    this.building = new DomainContext({ [path]: `http://localhost:8080/${location}` });
  }
  addControl(type: string) {
    this.controls.push(type);
    this.building.set(type,  'boo');
  }
  finalize() {
    const dest = `files/${this.location}.html`;
    this.logger.log(`writing to ${dest}`);
    writeFileSync(dest, this.controls.join('<br />\n'));
    return this.building;
  }
}
