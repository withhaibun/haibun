import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators';

import { TExpandedFeature } from '@haibun/core/build/lib/defs.js';

import type {
  TMessage,
  TMessageWithTopic,
} from '@haibun/core/build/lib/interfaces/logger.js';

async function connectToServer() {
  const host = document.location.hostname;

  const ws = new WebSocket(`ws://${host}:7071/ws`);
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (ws.readyState === 1) {
        clearInterval(timer);
        resolve(ws);
      }
    }, 10);
  });
}
export type TSeqFeature =
  | { seq: number; line: string; feature: TExpandedFeature }
  | {};
@customElement('message-processor')
export default class LogMessages extends LitElement {
  features: TSeqFeature[] = [];

  constructor() {
    super();
    this.connect();
  }

  checkForFeatures(m: TMessage) {
    const tm = (<TMessageWithTopic>m).messageTopic?.result.actionResults[0]
      .topics?.features;

    if (tm && (tm as any)[0]) {
      this.features = (tm as any)[0].expanded.map(
        (e: TExpandedFeature, seq: number) => ({ seq, ...e })
      );
      this.requestUpdate();
    }
  }

  @property({ type: Array }) messages: TMessage[] = [];

  async connect() {
    const ws: any = await connectToServer();
    ws.send('catchup');

    this.messages = [{ level: 'info', message: 'connecting' }];
    this.requestUpdate();

    ws.onmessage = (webSocketMessage: any) => {
      const msg = JSON.parse(webSocketMessage.data);
      if (msg.catchup) {
        this.messages = this.messages.concat(msg.catchup);
        this.messages.forEach(m => this.checkForFeatures(m));
      } else {
        const mt = <TMessage>msg;
        this.messages.push(mt);
        this.checkForFeatures(mt);
      }
      this.requestUpdate();
    };
  }

  render() {
    const topics: TMessageWithTopic[] = this.messages
      .filter(
        m => m.messageTopic !== undefined && m.messageTopic.stage === 'Executor'
      )
      .map(m => m as unknown as TMessageWithTopic);
    const messages: TMessage[] = this.messages.filter(
      m => m.messageTopic?.stage !== 'Executor'
    );

    return html`
        <div><topic-results .features="${this.features}" .topics="${topics}"></topic-results></topic-results> </div>
        <div><log-messages .messages="${messages}"></log-messages></div>
    `;
  }
}
