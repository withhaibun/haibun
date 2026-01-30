import { AStepper, IHasCycles } from '../astepper.js';
import { TWorld, IStepperCycles } from '../defs.js';
import { THaibunEvent } from '../../schema/protocol.js';

type EventFilterOptions = Partial<{
  kind: string;
  type: string;
  stage: string;
  in: string;
  [key: string]: unknown;
}>;

export class EventCollectorStepper extends AStepper implements IHasCycles {
  description = 'Collects events for test inspection';

  private events: THaibunEvent[] = [];

  cycles: IStepperCycles = {
    startScenario: () => {
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
    if (world.eventLogger?.setStepperCallback) {
      world.eventLogger.setStepperCallback((event: THaibunEvent) => {
        this.events.push(event);
      });
    }

    return Promise.resolve();
  }
  steps = {};

  getEvents(filterOrPredicate?: EventFilterOptions | ((e: THaibunEvent) => boolean)): THaibunEvent[] {
    const all = [...this.events];
    if (!filterOrPredicate) return all;
    if (typeof filterOrPredicate === 'function') return all.filter(filterOrPredicate);
    return all.filter(e => {
      for (const [key, value] of Object.entries(filterOrPredicate)) {
        const eventValue = (e as Record<string, unknown>)[key];
        if (key === 'in' && typeof eventValue === 'string') {
          if (!eventValue.includes(String(value))) return false;
        } else if (eventValue !== value) return false;
      }
      return true;
    });
  }

  assertNoSecrets(secretValues: string[]): void {
    const serialized = JSON.stringify(this.events);
    for (const secret of secretValues) {
      if (secret && serialized.includes(secret)) {
        throw new Error(`Secret value "${secret}" found in events - sanitization failed`);
      }
    }
  }

  containsValue(value: string): boolean {
    return JSON.stringify(this.events).includes(value);
  }
}

export default EventCollectorStepper;
