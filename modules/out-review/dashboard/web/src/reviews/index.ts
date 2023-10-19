import { LitElement, html, } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './components.js';
import { globalStyles } from './include.js';

import { TFoundHistories } from '@haibun/out-review/build/lib.js';
import { Router, TParams, TRoutable } from './router.js';

@customElement('reviews-shell')
export class ReviewsShell extends LitElement {
  router = new Router(<TRoutable>this);
  @property({ type: Object }) foundHistories?: TFoundHistories;
  @property({ type: String }) header = 'Reviews'; boundHandleHashChange: undefined | (() => void);
  @property({ type: String }) error?: string;

  constructor() {
    super();
  }
  // get source from location
  async _getSource() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (this.router.source === undefined) {
      this.error = 'source is missing';
      return;
    }
    this.foundHistories = await (await fetch(this.router.source)).json();
  }

  static styles = globalStyles;

  async connectedCallback() {
    await this._getSource();
    this.boundHandleHashChange = this.router.handleHashChange.bind(this.router);
    window.addEventListener('hashchange', this.boundHandleHashChange);
    super.connectedCallback();
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this.router.handleHashChange.bind(this));
    super.disconnectedCallback();
  }

  routes(params: TParams) {
    if (params.group !== undefined) {
      return html`<a-review .reviewLD=${this.foundHistories!.histories[this.router.group]}></a-review>`
    }
    return html`<reviews-groups .foundHistories=${this.foundHistories}></reviews-groups>`;
  }

  render() {
    if (this.error) {
      return html`<h1>${this.error}</h1>`;
    }
    if (this.router === undefined || this.foundHistories === undefined) {
      return html`<h1>Loading reviews</h1>`;
    }
    return html`
        <h1>⌂<a href=${this.router.link({})}>${this.header}</a></h1>
        <main>${this.router.outlet()}</main>
    `;
  }
}
