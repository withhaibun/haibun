import { AStepper, IHasCycles } from '../astepper.js';
import { TWorld, IStepperCycles } from '../defs.js';
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
export class EventCollectorStepper extends AStepper implements IHasCycles {
  description = 'Collects events for test inspection';

  private events: THaibunEvent[] = [];

  cycles: IStepperCycles = {
    startScenario: () => {
      // Hook into world event logger to collect events
      if (this.world?.eventLogger) {
        const originalCallback = (this.world.eventLogger as { stepperCallback?: (e: THaibunEvent) => void }).stepperCallback;
        this.world.eventLogger.setStepperCallback?.((event: THaibunEvent) => {
          this.events.push(event);
          originalCallback?.(event);
        });
      }
      return Promise.resolve();
    }
  };

  setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
    this.world = world;
    // Hook into world event logger immediately
    if (world.eventLogger?.setStepperCallback) {
      world.eventLogger.setStepperCallback((event: THaibunEvent) => {
        this.events.push(event);
      });
    }

    return Promise.resolve();
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
}

export default EventCollectorStepper;
