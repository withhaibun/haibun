import { Router } from '@lit-labs/router';
import { LitElement, html, } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './components.js';
import { reviewsLD, globalStyles, TRetrievedReviews } from './include.js';

import "urlpattern-polyfill";

// use hashLinks (client routing only)
const useHashlinks = true;

@customElement('reviews-shell')
export class ReviewsShell extends LitElement {
  private _realRouter = new Router(this, [
    { path: '/#review/:group/:id', render: ({ group, id }) => html`<a-review .reviewLD=${this.reviewsLD![group!][parseInt(id!, 10)]} />` },
    // FIXME 
    { path: '#review/:group/:id', render: ({ group, id }) => html`<a-review .reviewLD=${this.reviewsLD![group!][parseInt(id!, 10)]} />` },
    { path: '/', render: () => html`<reviews-groups .groups=${this.reviewsLD} />` },
  ]);
  @property({ type: Object }) reviewsLD?: TRetrievedReviews;

  @property({ type: String }) header = 'Reviews';

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
    this._fetchReviews();
    await this.handleInitialHashNavigation();
  }

  router() {
    return (window as any).router;
  }

  private async handleInitialHashNavigation() {
    const initialHash = window.location.hash;
    console.log('initialHash', initialHash)
    if (initialHash) {
      await this.router().goto(initialHash);
    }
  }

  _fetchReviews() {
    this.reviewsLD = reviewsLD;
  }

  render() {
    if (this.reviewsLD === undefined) {
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
