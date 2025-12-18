/**
 * TuiMonitorStepper - Terminal UI monitor using onEvent cycle.
 */

import React from 'react';
import { render, Text, Box, Static } from 'ink';
import { AStepper, IHasCycles, StepperKinds } from '@haibun/core/lib/astepper.js';
import { THaibunEvent } from '@haibun/core/lib/EventLogger.js';
import { EventFormatter } from '@haibun/core/monitor/index.js';

const EventLine = ({ line }: { line: string }) => <Text>{line}</Text>;

const RunningPanel = ({ steps, finished }: { steps: Map<string, string>; finished: boolean }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold>Haibun Monitor</Text>
    <Text underline>Running Steps:</Text>
    {Array.from(steps.entries()).map(([id, label]) => (
      <Text key={id} color="yellow">⏳ {label}</Text>
    ))}
    {!finished && steps.size === 0 && <Text color="gray">No active steps</Text>}
    {finished && <Text color="blue" bold>Finished</Text>}
  </Box>
);

const MonitorApp = ({ lines, running, finished }: { 
  lines: string[]; 
  running: Map<string, string>; 
  finished: boolean;
}) => (
  <Box flexDirection="column">
    <Static items={lines}>
      {(line, i) => <EventLine key={i} line={line} />}
    </Static>
    <RunningPanel steps={running} finished={finished} />
  </Box>
);

export default class TuiMonitorStepper extends AStepper implements IHasCycles {
  kind = StepperKinds.MONITOR;
  steps = {};
  
  private lines: string[] = [];
  private lastLevel: string = '';
  private running = new Map<string, string>();
  private finished = false;
  private rerender: ((lines: string[], running: Map<string, string>, finished: boolean) => void) | null = null;

  cycles = {
    startExecution: async () => {
      const { rerender } = render(
        <MonitorApp lines={[]} running={new Map()} finished={false} />
      );
      this.rerender = (lines, running, finished) => rerender(
        <MonitorApp lines={lines} running={running} finished={finished} />
      );
    },

    onEvent: (event: THaibunEvent): void => {
      if (EventFormatter.shouldDisplay(event)) {
        const line = EventFormatter.formatLine(event, this.lastLevel);
        this.lines = [...this.lines, line];
        this.lastLevel = EventFormatter.getDisplayLevel(event);
      }
      
      if (event.kind === 'lifecycle' && event.type === 'step') {
        if (event.stage === 'start') {
          this.running = new Map(this.running).set(event.id, event.in || '');
        } else if (event.stage === 'end') {
          this.running = new Map(this.running);
          this.running.delete(event.id);
        }
      }
      
      if (this.rerender) this.rerender(this.lines, this.running, this.finished);
    },

    endExecution: async () => {
      this.finished = true;
      render(<MonitorApp lines={this.lines} running={this.running} finished={true} />);
    }
  };
}
