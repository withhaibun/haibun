import { it, expect, describe, vi } from 'vitest';
import { DEF_PROTO_OPTIONS, getTestWorldWithOptions, testWithWorld } from '../lib/test/lib.js';
import DebuggerStepper, { TDebuggingType } from './debugger-stepper.js';
import Haibun from './haibun.js';
import { IPrompter, ReadlinePrompter, } from '../lib/prompter.js';

class TestPrompter implements IPrompter {
	prompt = async () => Promise.resolve('continue')
	cancel: () => void
}

describe('DebuggerStepper', () => {
	it('runs debug step by step', async () => {
		const feature = { path: '/features/test.feature', content: 'debug step by step\nThis should be prompted.' };
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new TestPrompter();
		vi.spyOn(testPrompter, 'prompt');
		world.prompter.subscribe(testPrompter);
		const res = await testWithWorld(world, [feature], [DebuggerStepper, Haibun]);
		expect(res.ok).toBe(true);
		expect(testPrompter.prompt).toHaveBeenCalledTimes(1);
	});

	it('continues', async () => {
		class ContinueDebuggerStepper extends DebuggerStepper {
			constructor() {
				super();
				this.debuggingType = TDebuggingType.Continue;
			}
		}
		const feature = { path: '/features/test.feature', content: 'debug step by step\ncontinue\n;; step' };
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new TestPrompter();
		vi.spyOn(testPrompter, 'prompt');
		world.prompter.subscribe(testPrompter);
		const res = await testWithWorld(world, [feature], [ContinueDebuggerStepper, Haibun]);
		expect(res.ok).toBe(true);
		expect(testPrompter.prompt).toHaveBeenCalledTimes(1);
	});
});
