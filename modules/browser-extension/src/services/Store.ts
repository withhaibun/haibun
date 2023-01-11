
export class Store {
  state: { [key: string]: any; } = {};

  commit(type: string, payload?: any) {
    this.state[type] = payload;
  }
}
