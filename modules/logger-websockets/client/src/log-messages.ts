import { customElement, html, LitElement, property } from 'lit-element';
import type { TMessage } from '@haibun/core/build/lib/interfaces/logger';

@customElement('log-messages')
export default class LogMessages extends LitElement {
  @property({ type: Array }) messages: TMessage[] = [];

  render() {
    return this.messages.map((m) => {
      const { level, message } = m;

      return html`<log-message
        level="${level}"
        message="${message}"
      ></log-message>`;
    });
  }
}
