import { TTag, WorkspaceBuilder } from './defs.js';

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

  set(name: string, value: string | boolean | object) {
    this.values[name] = value;
  }
  setOnly(name: string, value: string | boolean | object) {
    if (this.get(name)) {
      throw Error(`${name} is already set to ${this.values[name]}`);
    }
    this.set(name, value);
  }
  get(name: string) {
    return this.values[name];
  }
  concat(name: string, value: any) {
    const t = this.values[name] || [];
    this.values[name] = [...t, value];
  }
  unset(name: string) {
    delete this.values[name];
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
    return this.values._id;
  }
}

export class WorldContext extends Context {
  constructor(tag: TTag, initial?: { [name: string]: string }) {
    super(`world ${tag}`, initial);
  }
  static currentKey = (domain: string) => `_current_${domain}`;
  getCurrent = (type: string) => this.values[WorldContext.currentKey(type)];
  setDomainValues(domain: string, value: string) {
    if (typeof value !== 'string') throw Error(`not a string ${value}`);
    this.values[WorldContext.currentKey(domain)] = value;
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
