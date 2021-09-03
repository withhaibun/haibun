import { WorkspaceBuilder } from './defs';

export class Context {
  values: { [name: string]: any };
  context: string;

  constructor(context: string, initial?: { [name: string]: string }) {
    this.context = context;
    this.values = initial || {};
  }

  toString() {
    return `context ${this.context} values ${this.values}`;
  }

  set(name: string, value: string | boolean) {
    this.values[name] = value;
  }
  get(name: string) {
    return this.values[name];
  }
}

export class DomainContext extends Context {
  constructor(context: string, initial?: { [name: string]: string }) {
    super(`domain ${context}`, initial);
  }
  createPath(path: string, values?: { [name: string]: any }) {
    this.values[path] = new DomainContext(`path ${path}`, values);
    return this.values[path];
  }
  setId(id: string) {
    this.values.set('_id', id);
  }
  getID() {
    return this.values.get('_id');
  }
}

export class WorldContext extends Context {
  constructor(context: string, initial?: { [name: string]: string }) {
    super(`world ${context}`, initial);
  }
  static currentKey = (domain: string) => `_current_${domain}`;
  getCurrent = (type: string) => this.values[WorldContext.currentKey(type)];
  setDomain(which: string, value: string) {
    this.values[WorldContext.currentKey(which)] = value;
  }
}

export class WorkspaceContext extends Context {
  constructor(context: string, initial?: { [name: string]: string }) {
    super(`workspace ${context}`, initial);
  }
  builder: WorkspaceBuilder | undefined = undefined;
  createPath(path: string) {
    this.values[path] = new WorkspaceContext(`path ${path}`);
    return this.values[path];
  }
  addBuilder(what: WorkspaceBuilder) {
    this.builder = what;
  }
  getBuilder(): WorkspaceBuilder {
    if (!this.builder) {
      throw Error('no builder');
    }
    return this.builder!;
  }
}
