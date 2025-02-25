import { html } from "lit";

export type TRoutable = { requestUpdate: () => void, routes: (params: TParams) => ReturnType<typeof html> }

export type TParams = { [name: string]: string | number };

export type TWindowRouter = {
    _router: Router;
}

export class Router {
    index = '';
    source = '';
    group = '';
    currentHash = '';

    constructor(private routesFor: TRoutable) {
        (globalThis as unknown as TWindowRouter)._router = this;
        this._updateProps();
    }

    link(params: TParams) {
        return this._paramsToLink({ source: this.source, ...params });
    }

    outlet() {
        return this.routesFor.routes({ index: this.index, group: this.group });
    }

    private _paramsToLink(params: TParams) {
        const dest = `reviewer.html#source=${this.source}&` + Object.entries(params).map(([key, val]) => `${key}=${val}`).join('&');
        return dest;
    }
    handleHashChange() {
        this.currentHash = window.location.hash;
        this._updateProps();  // Add this line to update properties
        this.routesFor.requestUpdate();
    }
    private _updateProps() {
        const { source, group, index } = Object.fromEntries(new URLSearchParams(window.location.hash.substring(1)));
        this.source = source;
        this.group = group;
        this.index = index;
    }


}