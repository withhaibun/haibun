import { it, expect, describe, vi } from 'vitest';
import { DEF_PROTO_OPTIONS, getTestWorldWithOptions, testWithWorld } from '../lib/test/lib.js';
import DebuggerStepper, { TDebuggingType } from './debugger-stepper.js';
import Haibun from './haibun.js';
import { IPrompter } from '../lib/prompter.js';
import { ReadlinePrompter } from '../lib/readline-prompter.js';

class TestPrompter implements IPrompter {
	prompt = async () => Promise.resolve('continue');
	cancel = () => {};
	resolve: (_id: string, _value: unknown) => void = () => {};
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

describe('DebuggerStepper sequence integration', () => {
	it('beforeStep: increments seqPath with negative inc for debug prompts', async () => {
		class SequenceTestPrompter implements IPrompter {
			responses = [';;comment 1', ';;comment 2', 'step', 'step', 'continue'];
			idx = 0;
			prompt = async () => {
				const response = this.responses[this.idx++];
				return Promise.resolve(response);
			};
			cancel = () => {};
			resolve: (_id: string, _value: unknown) => void = () => {};
		}
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new SequenceTestPrompter();
		world.prompter.subscribe(testPrompter);
		const feature = { path: '/features/test.feature', content: 'debug step by step\nThis should be prompted.\nAnother step.' };
		const res = await testWithWorld(world, [feature], [DebuggerStepper, Haibun]);
		expect(res.ok).toBe(true);
		// [1,1,1] debug step by step, [1,1,2,-1] comment 1, [1,1,2,-2] comment 2, [1,1,2,-3] step (exits loop), [1,1,2] step 2, [1,1,3,-1] step (exits loop), [1,1,3] step 3
		const seqs = res.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1,1,1], [1,1,2,-1], [1,1,2,-2], [1,1,2,-3], [1,1,2], [1,1,3,-1], [1,1,3]]);
	});

	it('afterStep: increments seqPath with positive inc for failure prompts', async () => {
		const TestSteps = (await import('../lib/test/TestSteps.js')).default;
		class FailurePrompter implements IPrompter {
			responses = [';;comment 1', ';;comment 2', 'next'];
			idx = 0;
			prompt = async () => Promise.resolve(this.responses[this.idx++]);
			cancel = () => {};
			resolve: (_id: string, _value: unknown) => void = () => {};
		}
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new FailurePrompter();
		world.prompter.subscribe(testPrompter);
		// Use TestSteps' fails action
		const feature = { path: '/features/test.feature', content: 'fails' };
		const res = await testWithWorld(world, [feature], [DebuggerStepper, TestSteps, Haibun]);
		expect(res.ok).toBe(true); // 'next' allows continuation
		// [1,1,1] failed step, [1,1,1,1] comment 1, [1,1,1,2] comment 2, [1,1,1,3] next (exits loop)
		const seqs = res.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1,1,1], [1,1,1,1], [1,1,1,2], [1,1,1,3]]);
	});
});
