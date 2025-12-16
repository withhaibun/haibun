import { AStepper, IHasCycles, StepperKinds } from '../lib/astepper.js';
import { THaibunEvent } from '../lib/EventLogger.js';
import { Timer } from '../lib/Timer.js';
import { CHECK_YES, CHECK_NO } from '../lib/defs.js';

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

  cycles = {
    startExecution: () => {
      const options = this.getWorld()?.moduleOptions || {};
      this.verbose = options['HAIBUN_O_CONSOLEMONITORSTEPPER_CONSOLE_MONITOR_VERBOSE'] === 'true';
      this.showLogEvents = options['HAIBUN_O_CONSOLEMONITORSTEPPER_CONSOLE_MONITOR_LOGS'] !== 'false';
      this.showLifecycleEvents = options['HAIBUN_O_CONSOLEMONITORSTEPPER_CONSOLE_MONITOR_LIFECYCLE'] !== 'false';
    },

    onEvent: (event: THaibunEvent): void => {
      this.handleEvent(event);
    }
  };

  private handleEvent(event: THaibunEvent): void {
    if (event.kind === 'lifecycle' && this.showLifecycleEvents) {
      this.handleLifecycleEvent(event);
    } else if (event.kind === 'log' && this.showLogEvents) {
      this.handleLogEvent(event);
    } else if (event.kind === 'artifact') {
      this.handleArtifactEvent(event);
    } else if (event.kind === 'control' && this.verbose) {
      this.handleControlEvent(event);
    }
  }

  private handleLifecycleEvent(event: THaibunEvent & { kind: 'lifecycle' }): void {
    const isSpeculative = event.intent?.mode === 'speculative';

    let status: string;
    if (event.status === 'completed') {
      status = isSpeculative ? ' ✓' : CHECK_YES;
    } else if (event.status === 'failed') {
      status = isSpeculative ? ' ✗' : CHECK_NO;
    } else if (event.status === 'running') {
      status = '⏳';
    } else {
      status = ' •';
    }

    if (event.type === 'step') {
      if (event.stage === 'end' || this.verbose) {
        const error = event.error ? ` (${event.error})` : '';
        this.logLine('log', event, `${status} ${event.id} ${event.label}${error}`);
      }
    } else if (event.type === 'feature' && event.stage === 'start') {
      console.log('');
      this.logLine('feature', event, `📄 ${event.label}`);
    } else if (event.type === 'scenario' && event.stage === 'start') {
      this.logLine('scenario', event, `📋 ${event.label}`);
    }
  }

  private handleLogEvent(event: THaibunEvent & { kind: 'log' }): void {
    const levelIcon: Record<string, string> = {
      trace: '🔬', debug: '🐛', info: 'ℹ️', warn: '⚠️', error: '🚨'
    };
    const icon = levelIcon[event.level] || '•';

    if (this.verbose || ['info', 'warn', 'error'].includes(event.level)) {
      this.logLine(event.level, event, `${icon}${event.id} ${event.message}`);
    }
  }

  private handleArtifactEvent(event: THaibunEvent & { kind: 'artifact' }): void {
    const path = 'path' in event ? ` (${event.path})` : '';
    this.logLine('artifact', event, `📎 ${event.id} ${event.artifactType}${path}`);
  }

  private handleControlEvent(event: THaibunEvent & { kind: 'control' }): void {
    this.logLine('control', event, `⚙️ ${event.id} ${event.signal}`);
  }

  private logLine(level: string, event: THaibunEvent, message: string): void {
    const time = (Timer.since() / 1000).toFixed(3);
    const emitter = (event as any).emitter || 'unknown';
    const showLevel = this.lastLevel === level ? level.charAt(0) : level;
    this.lastLevel = level;

    const prefix = showLevel.padStart(8) + ` █ ${time}:${emitter}`.padEnd(32) + ` ｜ `;
    console.log(prefix + message);
  }
}
