import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { TFoundHistories, THistoryWithMeta, findArtifacts } from '@haibun/out-review/build/lib.js';
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
    .detail-container {
      width: 640px;
      margin-left: 10px;
    }`;
  artifacts: TLogHistory[] = [];
  videoOverview: TLogHistory | undefined;

  async connectedCallback() {
    this.artifacts = findArtifacts(this.reviewLD) || [];
    this.videoOverview = this.artifacts.find(a => a.messageContext.artifact?.type === 'video' && a.messageContext.artifact?.event === 'summary');
    this.videoDetail();
    await super.connectedCallback();
  }

  render() {
    if (!this.reviewLD) {
      return html`<h1>No data</h1>`;
    }
    return this.reviewLD && html`
      <ul>
        <h2><ok-indicator ?ok=${this.reviewLD.meta.ok}></ok-indicator>${this.reviewLD.meta.title}</h2>
        <div class="review-body">
          <div>
          ${this.reviewLD.logHistory.map(h => {
      return html`<review-step class="left-container" .logHistory=${h} @show-detail=${this.handleShowDetail}>></review-step>`
    })}
          </div>
          <div class="detail-container">${this.detail}</div>
        </div>
      </ul>
    `;
  }
  handleShowDetail(event: CustomEvent) {
    const detailHTML = event.detail;
    this.detail = html`${detailHTML}`;
  }
  videoDetail() {
    const content = getDetailContent(this.videoOverview?.messageContext?.artifact);
    this.detail = html`${content}`;
  }
}

@customElement('review-step')
export class ReviewStep extends LitElement {
  @property({ type: Array }) logHistory?: TLogHistory;

  render() {
    if (this.logHistory === undefined) return html``;
    const detailButton = this.logHistory.messageContext?.artifact && this.reportDetail(this.logHistory.messageContext?.artifact);
    // const ok = this.logHistory.message === "✅";
    return html`<li>${this.logHistory.message} ${detailButton}</li > `
  }
  reportDetail(artifact: TArtifact) {
    const content = getDetailContent(artifact);
    return html`<button @click=${() => this.showDetail(content)}>📁 ${artifact.event} ${artifact.type}</button>`;
  }
  showDetail(html: TemplateResult) {
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

function getDetailContent(artifact: TArtifact | undefined) {
  if (artifact === undefined) {
    return html`<div />`;
  } else if (artifact.type === 'html') {
    return html`${unsafeHTML(artifact.content)}`;
  } else if (artifact.type === 'video') {
    const videoPath = artifact?.path;
    return videoPath ? html`<video controls width="640"><source src=${videoPath} type="video/mp4"></video>` : html`<div />`;
  }
  return html`<img src=${artifact.path} alt=${JSON.stringify(artifact)} />`;
}
