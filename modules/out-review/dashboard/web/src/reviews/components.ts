import { LitElement, html, css, TemplateResult, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { controls } from './assets/reviews.js';

import { TFoundHistories, THistoryWithMeta, findArtifacts, asArtifact, asActionResult } from '@haibun/out-review/build/lib.js';
import { TWindowRouter } from './router.js';
import { TLogHistoryWithArtifact, TLogHistory, TArtifactMessageContext, TArtifact } from '@haibun/core/build/lib/interfaces/logger.js';

const router = () => (globalThis as unknown as TWindowRouter)._router;
@customElement('reviews-groups')
export class ReviewsGroups extends LitElement {

  @property({ type: Object }) foundHistories?: TFoundHistories;
  @property({ type: Object }) group?: string;
  @property({ type: Object }) index?: string;

  static styles = [controls];

  render() {
    if (!this.foundHistories) return html`<div>No reviews yet</div>`;
    const groups = Object.entries(this.foundHistories?.histories).map(([group, historyWithMeta], index) => {
      const route = router().link({ index, group });
      const titles = historyWithMeta.meta.title;
      const link = html`<a href=${route} >${titles}</a>`;
      return html`<li class="ok-${historyWithMeta.meta.ok}">${link} </li>`;
    });
    return html`<ul>${groups}</ul>`;
  }
}

@customElement('a-review')
export class AReview extends LitElement {
  @property({ type: Object }) reviewLD?: THistoryWithMeta;
  @property({ type: Object }) detail?: object;
  @property({ type: Boolean }) showDetails = false;

  static styles = [controls, css`.review-body {
      display: flex;
    }
    .left-container {
      flex-grow: 1;
    }
    .detail-container {
      width: 640px;
      margin-left: 10px;
    }`];
  artifacts: TLogHistoryWithArtifact[] = [];
  videoOverview: TLogHistoryWithArtifact | undefined;

  async connectedCallback() {
    this.artifacts = (findArtifacts(this.reviewLD) || []);
    this.videoOverview = this.artifacts.find(a => a.messageContext.artifact.type === 'video' && a.messageContext.topic.event === 'summary');
    this.videoDetail();
    await super.connectedCallback();
  }

  render() {
    const currentFilter = (h: TLogHistory) => this.showDetails ? h : (asActionResult(h) || (asArtifact(h) && asArtifact(h)?.messageContext?.topic?.event !== 'debug'));
    if (!this.reviewLD) {
      return html`<h1>No data</h1>`;
    }
    const checkbox = html`<input id="show-all-messages" type="checkbox" @change=${(e: Event) => this.showDetails = (<HTMLInputElement>e.target).checked} />`;
    return this.reviewLD && html`
      <div style="margin-left: 40px">
        <h2 class="ok-${this.reviewLD.meta.ok}">${this.reviewLD.meta.title}</h2>
        <div class="review-body">
          <div>
          ${(this.reviewLD.logHistory).filter(currentFilter).map(h => {
      return html`<review-step class="left-container" .logHistory=${h} @show-detail=${this.handleShowDetail}>></review-step>`
    })}
          </div>
          <div class="detail-container">
            ${checkbox} <label for="show-all-messages">Show all messages</label>
            ${this.detail}
          </div>
        </div>
      </div>
    `;
  }
  handleShowDetail(event: CustomEvent) {
    const detailHTML = event.detail;
    this.detail = html`${detailHTML}`;
  }
  videoDetail() {
    const content = getDetailContent(this.videoOverview?.messageContext.artifact);
    this.detail = html`${content}`;
  }
}

@customElement('review-step')
export class ReviewStep extends LitElement {
  static styles = [controls];
  @property({ type: Array }) logHistory?: TLogHistory;

  render() {
    const { logHistory } = this;
    const logArtifact = asArtifact(logHistory);
    const executorResult = asActionResult(logHistory);

    if (logHistory === undefined) {
      return html`<div>No history</div>`;
    }
    let okResult: string | symbol = nothing;
    okResult = executorResult ? `ok-${executorResult?.messageContext.topic.result.ok}` : nothing;
    const message = executorResult ? executorResult.messageContext.topic.step.in : logHistory.message;
    const loggerDisplay = executorResult ? nothing : this.loggerButton(logHistory.level);
    const detailButton = logArtifact && this.reportDetail(logArtifact.messageContext);
    return html`<div><span @click=${this.selectMessage} class=${okResult}>${loggerDisplay} ${message}</span> ${detailButton}</div > `
  }
  selectMessage() {
    this.showDetail(html`<div class="code">${JSON.stringify(this.logHistory, null, 2)}</div>`)
  }
  reportDetail(artifactContext: TArtifactMessageContext) {
    const content = getDetailContent(artifactContext.artifact);
    return html`<button @click=${() => this.showDetail(content)}>📁 ${artifactContext.topic.event} ${artifactContext.artifact.type}</button>`;
  }
  showDetail(html: TemplateResult) {
    this.dispatchEvent(new CustomEvent('show-detail', { detail: html }));
  }
  loggerButton(message: string) {
    return html`<span class="status">${message}</span>`;
  }
}

function getDetailContent(artifact: TArtifact | undefined) {
  if (artifact === undefined) {
    return html`<div />`;
  } else if (artifact.type === 'html') {
    return html`${unsafeHTML(artifact.content)}`;
  } else if (artifact.type.startsWith('json')) {
    return html`<div class="code">${JSON.stringify(artifact.content, null, 2)}</div>`;
  } else if (artifact.type === 'video') {
    const videoPath = artifact?.path;
    return videoPath ? html`<video controls width="640"><source src=${videoPath} type="video/mp4"></video>` : html`<div />`;
  }
  return html`<img src=${artifact.path} alt=${JSON.stringify(artifact)} />`;
}
