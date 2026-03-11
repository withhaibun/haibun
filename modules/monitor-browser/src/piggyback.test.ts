import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';

import Haibun from '@haibun/core/steps/haibun.js';
import { passWithDefaults, DEF_PROTO_OPTIONS } from '@haibun/core/lib/test/lib.js';
import MonitorBrowserStepper from './monitor-browser-stepper.js';
import { AStepper, StepperKinds } from '@haibun/core/lib/astepper.js';
import { RemoteTransport } from './remote-transport.js';
import { getStepperOptionName } from '@haibun/core/lib/util/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const CLI_PATH = path.join(ROOT, 'modules/cli/build/cli.js');
const MONITOR_STEPPER_PATH = path.join(__dirname, '../build/monitor-browser-stepper.js');
const STORAGE_STEPPER_PATH = path.join(ROOT, 'modules/storage-fs/build/storage-fs.js');
const HAIBUN_STEPPER_PATH = path.join(ROOT, 'modules/core/build/steps/haibun.js');

const PORT = 4789;
const HOST_URL = `http://127.0.0.1:${PORT}`;
const POLL_INTERVAL_MS = 200;

class MockStorageStepper extends AStepper {
  kind = StepperKinds.STORAGE;
  options = {
    STORAGE: {
      desc: 'Storage',
      parse: (input: string) => input
    }
  };
  steps = {};
  getCaptureLocation() {
    return 'test';
  }
  getArtifactBasePath() {
    return 'test-base';
  }
  saveArtifact() {
    return { absolutePath: 'test' };
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetch(url).catch(() => null);
    if (resp?.ok) return;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Health endpoint ${url} not reachable within ${timeoutMs}ms`);
}

describe('MonitorBrowserStepper Piggybacking', () => {
  let hostProcess: ChildProcess;

  beforeAll(async () => {
    const portOption = getStepperOptionName(MonitorBrowserStepper, 'PORT');
    const env = {
      ...process.env,
      [portOption]: String(PORT),
      HAIBUN_LOG_LEVEL: 'info',
      HAIBUN_STAY: 'always',
    };

    const projectPath = path.join(require('os').tmpdir(), 'haibun-piggyback-test');
    fs.mkdirSync(projectPath, { recursive: true });

    const config = {
      steppers: [
        MONITOR_STEPPER_PATH.replace(/\.js$/, ''),
        STORAGE_STEPPER_PATH.replace(/\.js$/, ''),
        HAIBUN_STEPPER_PATH.replace(/\.js$/, '')
      ],
      options: {}
    };
    fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify(config, null, 2));

    const featureFile = path.join(projectPath, 'features/host.feature');
    fs.mkdirSync(path.dirname(featureFile), { recursive: true });
    fs.writeFileSync(featureFile, 'Feature: Host\n\n  Scenario: Wait\n    Waiting for test.');

    hostProcess = spawn('node', [CLI_PATH, projectPath], { env, stdio: 'pipe' });
    hostProcess.on('error', (e) => { throw e; });

    await waitForHealth(`${HOST_URL}/api/health`, 10000);
  }, 15000);

  afterAll(() => {
    if (hostProcess) hostProcess.kill();
  });

  it('piggybacks on existing monitor and sends events', { timeout: 15000 }, async () => {
    const portOption = getStepperOptionName(MonitorBrowserStepper, 'PORT');

    const result = await passWithDefaults(
      [{ path: '/f.feature', content: 'Piggy.' }],
      [MonitorBrowserStepper, MockStorageStepper, Haibun],
      {
        ...DEF_PROTO_OPTIONS,
        moduleOptions: { [portOption]: String(PORT) }
      }
    );

    expect(result.ok).toBe(true);
    expect(MonitorBrowserStepper.transport).toBeInstanceOf(RemoteTransport);

    // Give async fetches a moment to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify the host received ingested events via its API
    const countResp = await fetch(`${HOST_URL}/api/ingest-count`);
    const { count } = await countResp.json() as { count: number };
    expect(count, 'Host should have ingested events from the piggybacker').toBeGreaterThan(0);
  });
});
