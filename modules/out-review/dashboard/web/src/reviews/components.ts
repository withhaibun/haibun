import { LitElement, html, css, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { TRetrievedReviews, TReview, TStep, globalStyles } from './include.js';

const router = () => (globalThis as any).router;

@customElement('reviews-groups')
export class ReviewsGroups extends LitElement {

  @property({ type: Object }) groups?: TRetrievedReviews;

  static styles = css`
    ul {
  list-style: none;
}

li.failed::before {
  content: "✕ ";
}

li.ok::before {
  content: "✓ ";
}`;

  render() {
    const groups = Object.entries(this.groups!).map(([source, reviews]) => {
      const sign = reviews.every(r => r.overview.ok) ? 'ok' : 'failed';
      return html`<li class=${sign}><bold>${source}</bold> <reviews-group .group=${source} .reviews=${reviews}></reviews-group></li>`;
    });
    return html`<ul>${groups}</ul>`;
  }
}

@customElement('reviews-group')
export class ReviewsGroup extends LitElement {
  @property({ type: Object }) reviews?: TReview[];
  @property({ type: String }) group = '';

  static styles = [globalStyles, css`
  .reviews-group {
    background-color: lightgrey;
    border-radius: 2px;
    margin: 1px;
    padding-left: 2px;
    padding-right: 2px;
    white-space: nowrap;
  }
  .failed-review {
    text-decoration: line-through;
  }`];

  render() {
    return this.reviews !== undefined && this.reviews.map(review => {
      const result = review.overview.ok ? nothing : 'failed-review';
      const index = this.reviews!.indexOf(review);
      const report = review.steps.find(step => step.report);
      return html`<span @click=${this._selectReview} @keydown=${this._onKeyDown} class="reviews-group">${review.overview.when} ${report && '📁 '}<a class=${ifDefined(result)} href=${router().link(`/review/${this.group}/${index}`)}> ${review.overview.title}</a> </span> `
    });
  }
  private _onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      this._selectReview(event).catch(console.error);
    }
  }

  async _selectReview(event: Event) {
    const anchor = event.target as HTMLAnchorElement;
    const href = anchor.getAttribute('href');
    if (href) {
      event.preventDefault();
      await router().goto(href);
    }
  }
}

@customElement('a-review')
export class AReview extends LitElement {
  @property({ type: Object }) reviewLD?: TReview;
  @property({ type: Object }) detail?: object;

  static styles = css`.review-body {
      display: flex;
    }
    .left-container {
      flex-grow: 1;
    }
    .right-container {
      width: 640px;
    }`;
  async connectedCallback() {
    await super.connectedCallback();
    this.videoDetail();
  }

  render() {
    return this.reviewLD && html`
      <div>
        <h2><ok-indicator ?ok=${this.reviewLD.overview.ok}></ok-indicator>${this.reviewLD.overview.title}</h2>
        <div class="review-body">
          <review-step class="left-container" .steps=${this.reviewLD.steps} @show-detail=${this.handleShowDetail}>></review-step>
          <div class="right-container">${this.detail}</div>
        </div>
      </div>
    `;
  }
  handleShowDetail(event: CustomEvent) {
    const detailHTML = event.detail;
    this.detail = html`<button @click=${this.videoDetail}>video</button>${unsafeHTML(detailHTML)}`;
  }
  videoDetail() {
    this.detail = html`<video controls width="640"><source src="path/to/your/video.mp4" type="video/mp4"></video>`;
  }
}

@customElement('review-step')
export class ReviewStep extends LitElement {
  @property({ type: Array }) steps?: TStep[];

  render() {
    return this.steps && html`
        <ul>
        ${this.steps.map(step => this._renderStep(step))}
        </ul>`;
  }

  private _renderStep(step: TStep) {
    if (this.steps === undefined) return html``;
    const detailButton = step.report?.html && html`<button @click=${() => this.showDetail(step.report!.html)}>📁 Report</button>`;
    return html`<li> ${step.description} <ok-indicator ?ok=${step.result}></ok-indicator> ${detailButton}</li > `
  }

  showDetail(html: string) {
    this.dispatchEvent(new CustomEvent('show-detail', { detail: html }));
  }
}

@customElement('ok-indicator')
class OkIndicator extends LitElement {
  @property({ type: Boolean }) ok = false;
  render() {
    return this.ok ? html`✓` : html`✕`;
  }
}