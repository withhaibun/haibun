import { describe, it, expect, vi } from 'vitest';
import { FeatureExecutor } from './Executor';
import { TFeatureResult, TStepActionResult } from '../lib/defs';
import { getDefaultWorld } from '../lib/test/lib';
import { actionNotOK, actionOK } from '../lib/util';
import { TRunnerCallbacks } from '../runner';

describe('Executor endFeatureCallback', () => {
	const world = getDefaultWorld(0, { HAIBUN_LOG_LEVEL: 'none' });

	const passingFeatureResult: TFeatureResult = {
		path: 'test.feature',
		ok: true,
		stepResults: [
			{
				ok: true,
				actionResult: actionOK() as TStepActionResult,
				in: 'test step',
				sourcePath: 'test.feature',
				seq: 1,
			},
		],
	};

	const failingFeatureResult: TFeatureResult = {
		path: 'test.feature',
		ok: false,
		stepResults: [
			{
				ok: false,
				actionResult: actionNotOK('test') as TStepActionResult,
				in: 'test step',
				sourcePath: 'test.feature',
				seq: 1,
			},
		],
		failure: {
			message: 'Test failure',
			error: new Error('Test error'),
		},
	};

	it('should call endFeatureCallback with passing result', async () => {
		const mockCallback = vi.fn();
		const callbacks: TRunnerCallbacks = { endFeature: [mockCallback] };
		const executor = new FeatureExecutor([], callbacks);

		await executor.setup(world);
		await executor.doEndFeatureCallback(passingFeatureResult);

		expect(mockCallback).toHaveBeenCalledWith(
			expect.objectContaining({
				world,
				result: passingFeatureResult,
				steppers: executor.steppers,
				startOffset: expect.any(Number),
			})
		);
	});

	it('should call endFeatureCallback with failing result', async () => {
		const mockCallback = vi.fn();
		const callbacks: TRunnerCallbacks = { endFeature: [mockCallback] };
		const executor = new FeatureExecutor([], callbacks);

		await executor.setup(world);
		await executor.doEndFeatureCallback(failingFeatureResult);

		expect(mockCallback).toHaveBeenCalledWith(
			expect.objectContaining({
				world,
				result: failingFeatureResult,
				steppers: executor.steppers,
				startOffset: expect.any(Number),
			})
		);
	});

	it('should handle multiple callbacks', async () => {
		const mockCallback1 = vi.fn();
		const mockCallback2 = vi.fn();
		const callbacks: TRunnerCallbacks = { endFeature: [mockCallback1, mockCallback2] };
		const executor = new FeatureExecutor([], callbacks);

		await executor.setup(world);
		await executor.doEndFeatureCallback(passingFeatureResult);

		expect(mockCallback1).toHaveBeenCalled();
		expect(mockCallback2).toHaveBeenCalled();
	});

	it('should handle callback throwing error', async () => {
		const mockCallback = vi.fn().mockRejectedValue(new Error('Callback error'));
		const callbacks: TRunnerCallbacks = { endFeature: [mockCallback] };
		const executor = new FeatureExecutor([], callbacks);

		await executor.setup(world);

		await expect(executor.doEndFeatureCallback(failingFeatureResult)).rejects.toThrow('Error: Callback error');
	});
});
