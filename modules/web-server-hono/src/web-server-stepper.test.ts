import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { passWithDefaults, DEF_PROTO_OPTIONS } from '@haibun/core/lib/test/lib.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { OK, type TStepArgs } from '@haibun/core/schema/protocol.js';
import { getStepperOptionName, actionNotOK } from '@haibun/core/lib/util/index.js';
import WebServerStepper from './web-server-stepper.js';

// WebServerStepper expects a 'files' directory in cwd
const FILES_DIR = path.join(process.cwd(), 'files');
const TEST_CONTENT_DIR = path.join(FILES_DIR, 'test-content');

beforeAll(() => {
  if (!fs.existsSync(TEST_CONTENT_DIR)) {
    fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(TEST_CONTENT_DIR, 'hello.txt'), 'Hello World');
});

afterAll(() => {
  // Clean up created files
  if (fs.existsSync(FILES_DIR)) {
    fs.rmSync(FILES_DIR, { recursive: true, force: true });
  }
});

class VerifyStepper extends AStepper {
  steps = {
    fetchFrom: {
      gwta: 'fetch from {url} includes {text}',
      action: async ({ url, text }: TStepArgs) => {
        try {
          const res = await fetch(String(url));
          if (!res.ok) {
            return actionNotOK(`Fetch failed: ${res.status} ${res.statusText}`);
          }
          const content = await res.text();
          if (content.includes(String(text))) {
            return OK;
          }
          return actionNotOK(`Expected ${text} in ${content}`);
        } catch (e) {
          return actionNotOK(String(e));
        }
      }
    }
  }
}

describe('WebServerStepper Integration', () => {
  it('serves files from a directory', async () => {
    const port = 8132;
    // Serve 'test-content' which is inside 'files'
    const feature = {
      path: '/features/test.feature',
      content: `
webserver is listening
serve files at /pub from test-content
fetch from http://localhost:${port}/pub/hello.txt includes "Hello World"
`
    };

    const moduleOptions = {
      [getStepperOptionName(WebServerStepper, 'PORT')]: String(port)
    };

    const result = await passWithDefaults([feature], [WebServerStepper, VerifyStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
    if (!result.ok) {
      console.error(JSON.stringify(result.featureResults?.[0].stepResults, null, 2));
    }
    expect(result.ok).toBe(true);
  });

  it('serves directory index', async () => {
    const port = 8133;
    const feature = {
      path: '/features/index.feature',
      content: `
webserver is listening
index files at /idx from test-content
fetch from http://localhost:${port}/idx/ includes "hello.txt"
`
    };

    const moduleOptions = {
      [getStepperOptionName(WebServerStepper, 'PORT')]: String(port)
    };

    const result = await passWithDefaults([feature], [WebServerStepper, VerifyStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
    if (!result.ok) {
      console.error(JSON.stringify(result.featureResults?.[0].stepResults, null, 2));
    }
    expect(result.ok).toBe(true);
  });
});


