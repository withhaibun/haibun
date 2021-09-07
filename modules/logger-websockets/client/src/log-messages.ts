import type { TMessage } from '@haibun/core/build/lib/interfaces/logger';
import './app-root';
import { customElement, html, LitElement, property } from 'lit-element';

@customElement('log-messages')
export default class LogMessages extends LitElement {
  constructor() {
    super();
    this.connect();
  }
  async connect() {
    const ws: any = await connectToServer();
    ws.send('catchup');

    this.messages = [{ level: 'info', message: 'connecting' }];
    this.requestUpdate();

    ws.onmessage = (webSocketMessage: any) => {
      const msg = JSON.parse(webSocketMessage.data);
      if (msg.catchup) {
        this.messages = this.messages.concat(msg.catchup);
      } else {
        this.messages.push(msg);
      }
      this.requestUpdate();
    };

    async function connectToServer() {
      const ws = new WebSocket('ws://localhost:7071/ws');
      return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          if (ws.readyState === 1) {
            clearInterval(timer);
            resolve(ws);
          }
        }, 10);
      });
    }
  }
  @property({ type: Array }) messages: TMessage[] = [];
  render() {
    return this.messages.map((m) => {
      const { level, message } = m;

      return html`<log-message
        level="${level}"
        message="${message}"
      ></log-message>`;
      // `<div><span>${m.level}</span><span>${m.message}</span></div>`;
    });
  }
}
