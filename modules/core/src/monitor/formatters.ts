/**
 * EventFormatter - Shared formatting for Haibun events.
 */

import { Timer } from '../lib/Timer.js';
import { CHECK_YES, CHECK_NO, MAYBE_CHECK_YES, MAYBE_CHECK_NO } from '../lib/defs.js';
import { THaibunEvent } from '../lib/EventLogger.js';

export type TIndication = 'success' | 'failure' | 'speculative-failure' | 'pending' | 'neutral';

export class EventFormatter {

  static shouldDisplay(event: THaibunEvent): boolean {
    if (event.kind === 'lifecycle') {
      if (event.type === 'step') return event.stage === 'end';
      if (event.type === 'feature' || event.type === 'scenario') return event.stage === 'start';
      return false;
    }
    if (event.kind === 'log') {
      return ['info', 'warn', 'error'].includes(event.level);
    }
    return false;
  }

  static getDisplayLevel(event: THaibunEvent): string {
    if (event.kind === 'lifecycle') {
      return event.type === 'step' ? 'log' : event.type;
    }
    if (event.kind === 'log') {
      return event.level;
    }
    return 'event';
  }

  static getStatusIcon(event: THaibunEvent & { kind: 'lifecycle' }): string {
    const isSpeculative = event.intent?.mode === 'speculative';
    if (event.status === 'completed') return isSpeculative ? ` ${MAYBE_CHECK_YES}` : CHECK_YES;
    if (event.status === 'failed') return isSpeculative ? ` ${MAYBE_CHECK_NO}` : CHECK_NO;
    if (event.status === 'running') return '⏳';
    return ' •';
  }

  static getIndication(event: THaibunEvent & { kind: 'lifecycle' }): TIndication {
    const isSpeculative = event.intent?.mode === 'speculative';
    if (event.status === 'completed') return 'success';
    if (event.status === 'failed') return isSpeculative ? 'speculative-failure' : 'failure';
    if (event.status === 'running') return 'pending';
    return 'neutral';
  }

  static formatLineElements(event: THaibunEvent, lastLevel?: string) {
    const time = (Timer.since() / 1000).toFixed(3);
    const emitter = (event as any).emitter || 'unknown';
    const level = this.getDisplayLevel(event);
    const showLevel = lastLevel === level ? level.charAt(0) : level;

    let icon = '';
    let id = '';
    let message = '';

    if (event.kind === 'lifecycle') {
      if (event.type === 'feature') {
        icon = '📄';
        message = event.label || '';
      } else if (event.type === 'scenario') {
        icon = '📋';
        message = event.label || '';
      } else {
        icon = this.getStatusIcon(event);
        id = event.id;
        message = event.label || '';
        if (event.error) message += ` (${event.error})`;
      }
    } else if (event.kind === 'log') {
      const levelIcons: Record<string, string> = { info: 'ℹ️', warn: '⚠️', error: '🚨' };
      icon = levelIcons[event.level] || '•';
      id = event.id;
      message = event.message;
    }
    return { time, emitter, level, showLevel, icon, id, message };
  }

  static formatLine(event: THaibunEvent, lastLevel?: string): string {
    const { time, emitter, level, showLevel, icon, id, message } = this.formatLineElements(event, lastLevel);
    const prefix = showLevel.padStart(6) + ` █ ${time}:${emitter}`.padEnd(32) + ` ｜ `;
    return prefix + `${icon}${id} ${message}`;
  }
}
