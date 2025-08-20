import { it, expect, describe } from 'vitest';

import { ServerExpress } from "./server-express.js"
import TestLogger from '@haibun/core/lib/TestLogger.js';

describe('mounts', () => {
	it('mounts a route', () => {
		const tl = new TestLogger();
		const se = new ServerExpress(tl, '/', 8999);
		se.listen = async () => Promise.resolve('started');
		expect(() => se.addRoute('get', '/', () => undefined)).not.toThrow();
	});
	it.skip('throws instead of double mounting a route', () => {
		const tl = new TestLogger();
		const se = new ServerExpress(tl, '/', 8999);
		se.listen = async () => Promise.resolve('started');
		void expect(async () => Promise.resolve(se.addRoute('get', '/', () => undefined))).rejects.toThrow();
	});
});


describe('checkMOunted', () => {
	it('throws on illegal characters', () => {
		const tl = new TestLogger();
		const se = new ServerExpress(tl, '/', 8999);
		se.listen = async () => Promise.resolve('started');
		expect(se.checkMountBadOrMounted('get', 'http://somewhere', 'test')).toMatch(/illegal characters/);
	});
	it('accepts placeholder', () => {
		const tl = new TestLogger();
		const se = new ServerExpress(tl, '/', 8999);
		se.listen = async () => Promise.resolve('started');
		expect(se.checkMountBadOrMounted('get', '/:id', 'test')).toBeUndefined();
	});
});
