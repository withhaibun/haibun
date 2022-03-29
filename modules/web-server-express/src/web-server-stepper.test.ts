import { testWithDefaults } from '@haibun/core/build/lib/test/lib';
import WebHttp from '@haibun/web-http/build/web-http';

import server from './web-server-stepper';

describe.skip('static mount', () => {
  it('serves files', async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\nfetch from http://localhost:8123/testfile is "content"` };
    const result = await testWithDefaults([feature], [server, WebHttp]);

    expect(result.ok).toBe(true);
  });

  it('restricts characters used in static mount folder name', async () => {
    const feature = { path: '/features/test.feature', content: `serve files from l*(*$\n` }
    const result = await testWithDefaults([feature], [server]);

    expect(result.ok).toBe(false);
  });
  it("doesn't re-mount same static mount", async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\nserve files from test\n` }
    const result = await testWithDefaults([feature], [server]);

    expect(result.ok).toBe(true);
  });
  it("doesn't permit different static mount", async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\nserve files from fails\n` }
    const result = await testWithDefaults([feature], [server]);

    expect(result.ok).toBe(false);
  });
});
