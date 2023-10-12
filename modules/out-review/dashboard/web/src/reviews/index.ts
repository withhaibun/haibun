import { Router } from '@lit-labs/router';
import { LitElement, html, } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './components.js';
import { globalStyles } from './include.js';

import "urlpattern-polyfill";
import { TFoundHistories } from '@haibun/out-review/build/out-reviews-stepper.js';

// use hashLinks (client routing only)
const useHashlinks = true;

@customElement('reviews-shell')
export class ReviewsShell extends LitElement {
  private _realRouter = new Router(this, [
    { path: '/reviews.html#/:source/:group/:id', render: ({ group }) => html`<a-review .reviewLD=${this.foundHistories?.histories[group!]} />` },
    // FIXME  alias
    { path: '/reviews.html#/:source/:group/:id', render: ({ group }) => html`<a-review .reviewLD=${this.foundHistories?.histories[group!]} />` },
    { path: '/reviews.html', render: () => html`<reviews-groups .foundHistories=${this.foundHistories} />` },
  ]);
  @property({ type: Object }) foundHistories?: TFoundHistories;

  @property({ type: String }) header = 'Reviews';

  // get source from location &source= query param
  async _getSource() {
    const url = new URL(window.location.href);
    const source = url.searchParams.get('source');
    if (!source) {
      throw new Error('No source found in URL');
    }
    this.foundHistories = await (await fetch(source)).json();
    console.log('reviewsLD', this.foundHistories)
  }

  static styles = globalStyles;

  async connectedCallback() {
    super.connectedCallback();
    (globalThis as any).router = useHashlinks ? {
      goto: async (where: string) => {
        console.log('ww', where)
        window.location.hash = where.replace(/.*#/, '');
        await this._realRouter.goto(where);
      },
      link: (link: string) => {
        const dest = link.replace(/^\//, '/#');
        return this._realRouter.link(dest);
      },
    } : this._realRouter;
    await this._getSource();
    await this.handleInitialHashNavigation();
  }

  router() {
    return (window as any).router;
  }

  private async handleInitialHashNavigation() {
    const initialHash = window.location.hash;
    if (initialHash) {
      await this.router().goto(initialHash);
    }
  }

  render() {
    if (this.foundHistories === undefined) {
      return html`<h1>Loading reviews</h1>`;
    }
    return html`
        <h1 @click=${this._home} @keydown=${this._home}>⌂<a href=${this.router().link('')}>${this.header}</a></h1>
        <main>${this._realRouter.outlet()}</main>
    `;
  }

  async _home(event: Event) {
    const anchor = event.target as HTMLAnchorElement;
    const href = anchor.getAttribute('href');
    if (href) {
      event.preventDefault();
      await this.router().goto(href);
    }
  }
}
