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
  @property({ type: String })
  level = '';
  @property({ type: String }) message = '';

  static get styles() {
    return css`
      p {
        color: blue;
      }
    `;
  }

  static get properties() {
    return {
      level: { type: String },
      message: { type: String },
    };
  }

  constructor() {
    super();
  }

  render(): TemplateResult {
    return html`<div>${this.level}: ${this.message}</div>`;
  }
}
