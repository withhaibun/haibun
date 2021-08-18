import { WorkspaceBuilder } from "./defs";

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
export class DomainContext extends Context {}

export class WorldContext extends Context {
  setDomain(which: string, value: string) {
    this.values[`${which}`] = value;
  }
}

export class WorkspaceContext extends Context {
  builder: WorkspaceBuilder | undefined = undefined;
   addBuilder(what: WorkspaceBuilder) {
    this.builder = what;
  }
  createPath(path: string) {
    this.values[path] = new WorkspaceContext();
  }
}

