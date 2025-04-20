import { describe, it, expect } from 'vitest';

import { spawnCommand } from './index.js';
describe('spawn', () => {
	it('should spawn', async () => {
		await expect(spawnCommand(['echo', 'hello'])).resolves.toBeDefined();
	});
	it('should catch failure', async () => {
		await expect(spawnCommand(['xecho', 'hello'])).rejects.toThrow();
	});
});
