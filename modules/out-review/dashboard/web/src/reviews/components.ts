import { LitElement, html, css, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { TFoundHistories, THistoryWithMeta } from '@haibun/out-review/build/out-reviews-stepper.js';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';

import { globalStyles } from './include.js';
import { TLogHistory } from '@haibun/core/build/lib/interfaces/logger.js';

const router = () => (globalThis as TAnyFixme).router;

@customElement('reviews-groups')
export class ReviewsGroups extends LitElement {

  @property({ type: Object }) foundHistories?: TFoundHistories;

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
    if (!this.foundHistories) return html`<div>No reviews yet</div>`;
    const groups = Object.entries(this.foundHistories?.histories).map(([source, historyWithMeta], index) => {
      const route = router().link(`/review.html/${source}/${index}`);
      const titles = historyWithMeta.meta.title;
      const link = html`<a href=${route} >${titles}</a>`;
      return html`<li class=${historyWithMeta.meta.ok}><bold>${source}</bold>${link} </li>`;
    });
    return html`<ul>${groups}</ul>`;
  }
}

@customElement('a-review')
export class AReview extends LitElement {
  @property({ type: Object }) reviewLD?: THistoryWithMeta;
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
    // return this.reviewLD && html`
    //   <div>
    //     <h2><ok-indicator ?ok=${this.reviewLD.overview.ok}></ok-indicator>${this.reviewLD.overview.title}</h2>
    //     <div class="review-body">
    //       <review-step class="left-container" .steps=${this.reviewLD.steps} @show-detail=${this.handleShowDetail}>></review-step>
    //       <div class="right-container">${this.detail}</div>
    //     </div>
    //   </div>
    // `;
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
  @property({ type: Array }) steps?: TLogHistory;

  render() {
    // return this.steps && html`
    //     <ul>
    //     ${this.steps.map(step => this._renderStep(step))}
    //     </ul>`;
  }

  private _renderStep(step: TLogHistory) {
    if (this.steps === undefined) return html``;
    // const detailButton = step.report?.html && html`<button @click=${() => this.showDetail(step.report!.html)}>📁 Report</button>`;
    // return html`<li> ${step.description} <ok-indicator ?ok=${step.result}></ok-indicator> ${detailButton}</li > `
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