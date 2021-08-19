import { WorkspaceBuilder } from './defs';

export class Context {
  values: { [name: string]: any };

  constructor(initial?: { [name: string]: string }) {
    this.values = initial || {};
  }

  set(name: string, value: string | boolean) {
    this.values[name] = value;
  }
  get(name: string) {
    return this.values[name];
  }
}

export class DomainContext extends Context {
  createPath(path: string) {
    this.values[path] = new DomainContext();
    return this.values[path];
  }
}

export class WorldContext extends Context {
  static currentKey = (domain: string) => `_current_${domain}`;
  getCurrent = (type: string) => this.values[WorldContext.currentKey(type)];
  setDomain(which: string, value: string) {
    this.values[WorldContext.currentKey(which)] = value;
  }
}

export class WorkspaceContext extends Context {
  builder: WorkspaceBuilder | undefined = undefined;
  createPath(path: string) {
    this.values[path] = new WorkspaceContext();
    return this.values[path];
  }
  addBuilder(what: WorkspaceBuilder) {
    this.builder = what;
    console.log('xx', this.builder);
    
  }
  getBuilder(): WorkspaceBuilder {
    if (!this.builder) {
      throw Error('no builder');
    }
    return this.builder!;
  }
}
