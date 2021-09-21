import { html, LitElement, TemplateResult } from 'lit';

import { customElement, property } from 'lit/decorators';

@customElement('log-message')
export default class LogMessage extends LitElement {
  @property({ type: String }) level = '';

  @property({ type: String }) message = '';

  render(): TemplateResult {
    return html`<div>${this.level}: ${this.message}</div>`;
  }
}
