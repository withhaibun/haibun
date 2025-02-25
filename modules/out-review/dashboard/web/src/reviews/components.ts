import { LitElement, html, css, TemplateResult, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import './json-view-clipboard.js';

import { controls, documentation } from './assets/reviews.js';
import { findArtifacts, asArtifact, asActionResult, actionName, TFoundHistories } from '@haibun/core/build/lib/LogHistory.js';
import { TWindowRouter } from './router.js';
import { THistoryWithMeta, TLogHistoryWithArtifact, TLogHistory, TArtifactMessageContext, TArtifact } from '@haibun/core/build/lib/interfaces/logger.js';

const VIEW_RESULTS = 'results';
const VIEW_EVERYTHING = 'everything';
const VIEW_DOCUMENTATION = 'documentation';

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
      const titles = historyWithMeta.meta.feature;
      const link = html`<a href=${route} >${titles}</a>`;
      return html`<li class="ok-${historyWithMeta.meta.ok}">${link} </li>`;
    });
    return html`<ul>${groups}</ul>`;
  }
}
const views = [VIEW_RESULTS, VIEW_EVERYTHING, VIEW_DOCUMENTATION] as const;
type TView = typeof views[number];
@customElement('a-review')
export class AReview extends LitElement {
  @property({ type: Object }) reviewLD?: THistoryWithMeta;
  @property({ type: Object }) detail?: object;
  @property({ type: String }) view: TView = VIEW_RESULTS;

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
    this.initializeFromCookie();
    await super.connectedCallback();
  }

  currentFilter = (h: TLogHistory) => {
    if (this.view === VIEW_EVERYTHING) {
      return true;
    }
    const action = asActionResult(h);
    if (this.view === VIEW_RESULTS) {
      return (!!action || (asArtifact(h) && asArtifact(h)?.messageContext?.topic?.event !== 'debug'));
    }
    // VIEW_DOCUMENTATION
    if (action) {
      const { actionName, stepperName } = action.messageContext.topic.step.action;
      if (['set', 'setAll'].includes(actionName)) {
        return false;
      }
      return true;
    }
    return ((asArtifact(h) || {})?.messageContext?.topic?.event !== 'debug');
  };
  render() {
    const viewStyle = this.view === VIEW_DOCUMENTATION ? html`<style>${documentation}</style>` : nothing;
    if (!this.reviewLD) {
      return html`<h1>No data</h1>`;
    }
    const chooseView = html`
  <select class="styled-select" @change=${(e: Event) => { this.view = <TView>(<HTMLSelectElement>e.target).value; this.requestUpdate() }}>
    ${views.map(option => html`
      <option ?selected=${this.view === option} value=${option}>
        ${option.charAt(0).toUpperCase() + option.slice(1)}
      </option>
    `)}
  </select>
`;

    return this.reviewLD && html`
            <div style="margin-bottom: 4px; padding-left: 20px">View ${chooseView} <label for="show-all-messages"></label></div>
      ${viewStyle}
      <div style="margin-left: 40px">
        <h2 class="ok-${this.reviewLD.meta.ok}">${this.reviewLD.meta.feature}</h2>
        <div class="review-body">
          <div>
          ${(this.reviewLD.logHistory).filter(this.currentFilter).map(h => {
      return html`<review-step class="left-container" ?showLogLevel=${this.view !== VIEW_DOCUMENTATION} .logHistory=${h} @show-detail=${this.handleShowDetail}> .view=${this.view}></review-step>`
    })}
          </div>
          <div class="detail-container">
            ${this.detail}
          </div>
        </div>
      </div>
    `;
  }
  handleShowDetail(event: CustomEvent) {
    const detailHTML = event.detail;
    this.detail = html`${detailHTML}`;
    this.requestUpdate();
  }
  videoDetail() {
    const content = getDetailContent(this.videoOverview?.messageContext.artifact);
    this.detail = html`${content}`;
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('view')) {
      this.saveToCookie();
    }
  }

  initializeFromCookie() {
    const cookieValue = this.getCookie('view');
    console.log('cookie ', cookieValue)
    if (cookieValue !== null) {
      this.view = <TView>cookieValue;
    }
  }

  saveToCookie() {
    console.log('saving cookie', this.view)
    document.cookie = `view=${this.view};path=/;max-age=31536000`; // Expires in 1 year
  }

  getCookie(name: string): string | null {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) == ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }
}

@customElement('review-step')
export class ReviewStep extends LitElement {
  @property({ type: Array }) logHistory?: TLogHistory;
  @property({ type: Boolean }) showLogLevel = true;

  static styles = [controls];

  render() {
    const { logHistory } = this;
    const logArtifact = asArtifact(logHistory);
    const executorResult = asActionResult(logHistory);

    if (logHistory === undefined) {
      return html`<div>No history</div>`;
    }
    const okClasses = [`stepper-${actionName(logHistory)}`];
    const result = executorResult?.messageContext.topic.result.ok;
    if (result !== undefined) {
      okClasses.push(`ok-${result}`);
    } else if (logArtifact !== undefined) {
      okClasses.push('artifact');
    }
    const message = executorResult ? executorResult.messageContext.topic.step.in : logHistory.message;
    const loggerDisplay = (!this.showLogLevel || executorResult) ? nothing : this.loggerButton(logHistory.level);
    const detailButton = logArtifact && this.reportDetail(logArtifact.messageContext);
    const actionClass = 'stepper-' + (actionName(logHistory) || 'unknown');
    return html`<div part="review-step" class="stepper ${actionClass}"><span @click=${this.selectMessage} class=${okClasses.filter(Boolean).join(' ')}>${loggerDisplay} ${message}</span> ${detailButton}</div > `
  }
  selectMessage() {
    this.showDetail(html`<json-view-clipboard .json=${this.logHistory}></json-view-clipboard>`);
  }
  reportDetail(artifactContext: TArtifactMessageContext) {
    const content = getDetailContent(artifactContext.artifact);
    return html`<button class="artifact-button" @click=${() => this.showDetail(content)}>${artifactContext.topic.event} ${artifactContext.artifact.type}</button>`;
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
    try {
      return html`<json-view-clipboard .json=${JSON.parse(artifact.content)}></json-view-clipboard>`;
    } catch (e) {
      return html`<div class="code">Not JSON: ${artifact.content}</div>`;
    }
  } else if (artifact.type === 'video') {
    const videoPath = artifact?.path;
    return videoPath ? html`<video controls width="640"><source src=${videoPath} type="video/mp4"></video>` : html`<div />`;
  }
  return html`<img src=${artifact.path} alt=${JSON.stringify(artifact)} />`;
}
