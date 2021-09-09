import {
  css,
  customElement,
  html,
  LitElement,
  property,
  TemplateResult,
} from 'lit-element';

@customElement('log-message')
export default class LogMessage extends LitElement {
  @property({ type: String }) level = '';
  @property({ type: String }) message = '';
  @property({ type: String }) topic = {};

  static get styles() {
    return css`
      p {
        color: blue;
      }
    `;
  }

  render(): TemplateResult {
    return html`<div>${this.level}: ${this.message}</div>`;
  }
}
