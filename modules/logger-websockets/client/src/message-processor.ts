import { customElement, html, LitElement, property } from 'lit-element';
import type {
  TMessage,
  TMessageWithTopic,
} from '@haibun/core/build/lib/interfaces/logger';

@customElement('message-processor')
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
      return new Promise((resolve) => {
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
    const topics: TMessageWithTopic[] = this.messages
      .filter(
        m => m.messageTopic !== undefined && m.messageTopic.stage === 'Executor'
      )
      .map(m => m as TMessageWithTopic);
    const messages: TMessage[] = this.messages.filter(
      m => m.messageTopic?.stage !== 'Executor'
    );
    return html`
      <vaadin-split-layout>
        <div style="width: 65%"><topic-results .topics="${topics}"></topic-results></topic-results> </div>
        <div style="width: 35%"><log-messages .messages="${messages}"></log-messages></div>
      </vaadin-split-layout>
    `;
  }
}
