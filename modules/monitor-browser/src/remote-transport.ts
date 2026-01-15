
import { type IEventLogger } from '@haibun/core/lib/EventLogger.js';
import type { THaibunEvent } from '@haibun/core/schema/protocol.js';
import { stepTraceStorage } from '@haibun/core/lib/node-http-events.js';
import type { ITransport } from './sse-transport.js';

export class RemoteTransport implements ITransport {
  constructor(private ingestUrl: string, private logger: IEventLogger) { }

  // biome-ignore lint/suspicious/noExplicitAny: generic message handler
  send(message: any): void {
    // Only send events, not init/finalize control messages for now unless ingest supports them
    if (message.type === 'event') {
      void this.post(message.event);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: generic message handler
  onMessage(cb: (message: any) => void): void {
    // Remote control not yet implemented for piggybacking
  }

  private async post(event: THaibunEvent) {
    try {
      await stepTraceStorage.run(undefined, async () => {
        await fetch(this.ingestUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event)
        });
      });
    } catch (e) {
      this.logger.warn(`RemoteTransport: Failed to send event to ${this.ingestUrl}: ${e}`);
    }
  }
}
