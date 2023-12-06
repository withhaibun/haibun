import { it, expect, describe } from 'vitest';

import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import WebHttp from '@haibun/web-http/build/web-http.js';

import server from './web-server-stepper.js';

describe('static mount', () => {
  it.skip('serves files', async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\nhttp get from http://localhost:8123/testfile webpage returns content "content"` };
    const result = await testWithDefaults([feature], [server, WebHttp]);
    expect(result.ok).toBe(true);
  });

  it('restricts characters used in static mount folder name', async () => {
    const feature = { path: '/features/test.feature', content: `serve files from l*(*$\n` }
    const result = await testWithDefaults([feature], [server]);
    expect(result.ok).toBe(false);
  });
  it.skip("doesn't re-mount same static mount", async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\nserve files from test\n` }
    const result = await testWithDefaults([feature], [server]);
    expect(result.ok).toBe(false);
  });
  it.skip("doesn't permit different static mount", async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\nserve files from fails\n` }
    const result = await testWithDefaults([feature], [server]);
    expect(result.ok).toBe(false);
  });
});

describe.skip('index mount', () => {
  // FIXME: This fails when both tests are run
  it('index files at', async () => {
    const feature = { path: '/features/test.feature', content: `index files at /test from test\nfetch from http://localhost:8123/test/ contains href="/test/testfile"\nfetch from http://localhost:8123/test/testfile matches "content"` };
    const result = await testWithDefaults([feature], [server, WebHttp]);
    expect(result.ok).toBe(true);
  });
  it('index files', async () => {
    const feature = { path: '/features/test.feature', content: `index files from test\nfetch from http://localhost:8123/ contains href="/testfile"\nfetch from http://localhost:8123/testfile matches "content"` };
    const result = await testWithDefaults([feature], [server, WebHttp]);
    expect(result.ok).toBe(true);
  });
});
