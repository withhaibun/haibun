import { it, expect, describe } from 'vitest';

import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import WebHttp from '@haibun/web-http/build/web-http.js';

import WebServerStepper from './web-server-stepper.js';
import { getDefaultWorld } from '@haibun/core/build/lib/test/lib.js';
import { TEST_PORTS } from './test-constants.js';

describe('static mount', () => {
	it.skip('serves files', async () => {
		const feature = { path: '/features/test.feature', content: `serve files from test\nhttp get from http://localhost:${TEST_PORTS.WEB_SERVER_FILES}/testfile webpage returns content "content"` };
		const result = await testWithDefaults([feature], [WebServerStepper, WebHttp]);
		expect(result.ok).toBe(true);
	});

	it('restricts characters used in static mount folder name', async () => {
		const feature = { path: '/features/test.feature', content: `serve files from l*(*$\n` }
		const result = await testWithDefaults([feature], [WebServerStepper]);
		expect(result.ok).toBe(false);
	});
	it.skip("doesn't re-mount same static mount", async () => {
		const feature = { path: '/features/test.feature', content: `serve files from test\nserve files from test\n` }
		const result = await testWithDefaults([feature], [WebServerStepper]);
		expect(result.ok).toBe(false);
	});
	it.skip("doesn't permit different static mount", async () => {
		const feature = { path: '/features/test.feature', content: `serve files from test\nserve files from fails\n` }
		const result = await testWithDefaults([feature], [WebServerStepper]);
		expect(result.ok).toBe(false);
	});
});

describe.skip('index mount', () => {
	// FIXME: This fails when both tests are run
	it('index files at', async () => {
		const feature = { path: '/features/test.feature', content: `index files at /test from test\nfetch from http://localhost:${TEST_PORTS.WEB_SERVER_INDEX}/test/ contains href="/test/testfile"\nfetch from http://localhost:${TEST_PORTS.WEB_SERVER_INDEX}/test/testfile matches "content"` };
		const result = await testWithDefaults([feature], [WebServerStepper, WebHttp]);
		expect(result.ok).toBe(true);
	});
	it('index files', async () => {
		const feature = { path: '/features/test.feature', content: `index files from test\nfetch from http://localhost:${TEST_PORTS.WEB_SERVER_INDEX}/ contains href="/testfile"\nfetch from http://localhost:${TEST_PORTS.WEB_SERVER_INDEX}/testfile matches "content"` };
		const result = await testWithDefaults([feature], [WebServerStepper, WebHttp]);
		expect(result.ok).toBe(true);
	});
});

describe('closes mounts', () => {
	it('re-mounts after close', async () => {
		const world = getDefaultWorld(0);
		const wss = new WebServerStepper();
		await wss.setWorld(getDefaultWorld(0), []);
		await wss.steps.serveFilesAt.action({ where: '/foo' })
		expect(async () => {
			if (!wss.cycles || !wss.cycles.endFeature) {
				throw new Error('no cycles');
			}
			await wss.cycles.endFeature({ world, shouldClose: true, isLast: true, okSoFar: true, continueAfterError: false, stayOnFailure: false, thisFeatureOK: true });
			return wss.steps.serveFilesAt.action({ where: '/foo' });
		}).not.toThrow();
	});
})
