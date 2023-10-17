import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { TFoundHistories, THistoryWithMeta } from '@haibun/out-review/build/out-reviews-stepper.js';
import { TArtifact, TLogHistory } from '@haibun/core/build/lib/interfaces/logger.js';
import { TWindowRouter } from './router.js';

const router = () => (globalThis as unknown as TWindowRouter)._router;

@customElement('reviews-groups')
export class ReviewsGroups extends LitElement {

  @property({ type: Object }) foundHistories?: TFoundHistories;
  @property({ type: Object }) group?: string;
  @property({ type: Object }) index?: string;

  static styles = css`
    ul {
  list-style: none;
}

li.false::before {
  content: "✕ ";
}

li.true::before {
  content: "✓ ";
}`;

  render() {
    if (!this.foundHistories) return html`<div>No reviews yet</div>`;
    const groups = Object.entries(this.foundHistories?.histories).map(([group, historyWithMeta], index) => {
      const route = router().link({ index, group });
      const titles = historyWithMeta.meta.title;
      const link = html`<a href=${route} >${titles}</a>`;
      return html`<li class=${historyWithMeta.meta.ok}>${link} </li>`;
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
    ul {
     list-style: none;
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
      <ul>
        <h2><ok-indicator ?ok=${this.reviewLD.meta.ok}></ok-indicator>${this.reviewLD.meta.title}</h2>
        <div class="review-body">
          <div>
          ${this.reviewLD.logHistory.map(h => {
      return html`<review-step class="left-container" .logHistory=${h} @show-detail=${this.handleShowDetail}>></review-step>`
    })}
          </div>
          <div class="right-container">${this.detail}</div>
        </div>
      </ul>
    `;
  }
  handleShowDetail(event: CustomEvent) {
    const detailHTML = event.detail;
    this.detail = html`<button @click=${this.videoDetail}>video</button>${unsafeHTML(detailHTML)}`;
  }
  videoDetail() {
    this.detail = html`<video controls width="640"><source src="/video.webm" type="video/mp4"></video>`;
  }
}

@customElement('review-step')
export class ReviewStep extends LitElement {
  @property({ type: Array }) logHistory?: TLogHistory;

  render() {
    if (this.logHistory === undefined) return html``;
    const detailButton = this.logHistory.messageContext?.artifact?.content && this.reportDetail(this.logHistory.messageContext?.artifact);
    // const ok = this.logHistory.message === "✅";
    return html`<li>${this.logHistory.message} ${detailButton}</li > `
  }
  reportDetail(artifact: TArtifact) {
    if (artifact.type === 'html') {
      return html`<button @click=${() => this.showDetail(artifact.content)}>📁 Report</button>`;
    } else {
      return html`<button @click=${() => this.showDetail(JSON.stringify(artifact))}>📁 Report</button>`;
    }
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
