import { AStepper, IHasCycles, StepperKinds } from '../lib/astepper.js';
import { THaibunEvent } from '../schema/protocol.js';
import { Timer } from '../schema/protocol.js';
import { CHECK_YES, CHECK_NO } from '../schema/protocol.js';
import { EventFormatter } from '../monitor/index.js';

/**
 * ConsoleMonitorStepper - Console monitor using the onEvent pattern.
 */
export default class ConsoleMonitorStepper extends AStepper implements IHasCycles {
  kind = StepperKinds.MONITOR;
  steps = {};

  options = {
    CONSOLE_MONITOR_VERBOSE: {
      desc: 'Show all events including step starts',
      parse: (s: string) => ({ result: s === 'true' }),
    },
    CONSOLE_MONITOR_LOGS: {
      desc: 'Show log events (default: true)',
      parse: (s: string) => ({ result: s !== 'false' }),
    },
    CONSOLE_MONITOR_LIFECYCLE: {
      desc: 'Show lifecycle events (default: true)',
      parse: (s: string) => ({ result: s !== 'false' }),
    },
  };

  private verbose: boolean = false;
  private showLogEvents: boolean = true;
  private showLifecycleEvents: boolean = true;
  private lastLevel: string = '';
  private minLevel: string = 'info';

  cycles = {
    startExecution: () => {
      const options = this.getWorld()?.moduleOptions || {};
      this.verbose = options['HAIBUN_O_CONSOLEMONITORSTEPPER_CONSOLE_MONITOR_VERBOSE'] === 'true';
      this.showLogEvents = options['HAIBUN_O_CONSOLEMONITORSTEPPER_CONSOLE_MONITOR_LOGS'] !== 'false';
      this.showLifecycleEvents = options['HAIBUN_O_CONSOLEMONITORSTEPPER_CONSOLE_MONITOR_LIFECYCLE'] !== 'false';
      this.minLevel = (process.env.HAIBUN_LOG_LEVEL as string) || (options['HAIBUN_LOG_LEVEL'] as string) || 'info';
    },

    onEvent: (event: THaibunEvent): void => {
      this.handleEvent(event);
    }
  };

  private handleEvent(event: THaibunEvent): void {
    // Determine visibility
    let visible = EventFormatter.shouldDisplay(event, this.minLevel as any);

    // allow verbose to override hidden start steps
    if (this.verbose && event.kind === 'lifecycle' && !visible) {
      visible = true;
    }

    if (!visible) return;

    if (event.kind === 'lifecycle' && !this.showLifecycleEvents) return;
    if (event.kind === 'log' && !this.showLogEvents) return;

    // Handle extra newlines for structure
    if (event.kind === 'lifecycle' && event.stage === 'start') {
      if (event.type === 'feature' || event.type === 'scenario') {
        console.log('');
      }
    }

    // Format and log
    const line = EventFormatter.formatLine(event, this.lastLevel);
    this.lastLevel = EventFormatter.getDisplayLevel(event);
    console.log(line);
  }


}
