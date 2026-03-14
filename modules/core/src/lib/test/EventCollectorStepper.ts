import { AStepper } from '../astepper.js';
import { TWorld } from '../defs.js';
import { THaibunEvent } from '../../schema/protocol.js';

/**
 * EventCollectorStepper - Collects events for test inspection.
 *
 * Usage in tests:
 * ```ts
 * const collector = new EventCollectorStepper();
 * const res = await passWithDefaults(content, [collector, ...steppers]);
 * const events = collector.getEvents();
 * const stepEvents = collector.getStepEvents();
 * ```
 */
export class EventCollectorStepper extends AStepper {
  description = 'Collects events for test inspection';

  private events: THaibunEvent[] = [];
  private subscriberCallback?: (event: THaibunEvent) => void;

  async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
    await super.setWorld(world, steppers);
    this.subscriberCallback = (event: THaibunEvent) => {
      this.events.push(event);
    };
    world.eventLogger.subscribe(this.subscriberCallback);
  }

  steps = {};

  /** Get all collected events */
  getEvents(): THaibunEvent[] {
    return [...this.events];
  }

  /** Get step lifecycle events only */
  getStepEvents(): THaibunEvent[] {
    return this.events.filter(e => 'type' in e && e.type === 'step');
  }

  /** Get events matching a predicate */
  findEvents(predicate: (e: THaibunEvent) => boolean): THaibunEvent[] {
    return this.events.filter(predicate);
  }

  /** Clear collected events */
  clear(): void {
    this.events = [];
  }

  /** Unsubscribe from event logger */
  close(): void {
    if (this.subscriberCallback && this.world?.eventLogger) {
      this.world.eventLogger.unsubscribe(this.subscriberCallback);
      this.subscriberCallback = undefined;
    }
  }
}

export default EventCollectorStepper;
