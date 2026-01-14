import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';

import Haibun from '@haibun/core/steps/haibun.js';
import { passWithDefaults, DEF_PROTO_OPTIONS } from '@haibun/core/lib/test/lib.js';
import MonitorBrowserStepper, { LOG_HOST_STARTED, LOG_INGESTED } from './monitor-browser-stepper.js';
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

describe('MonitorBrowserStepper Piggybacking', () => {
  let hostProcess: ChildProcess;

  beforeAll(async () => {
    const portOption = getStepperOptionName(MonitorBrowserStepper, 'PORT');
    const env = {
      ...process.env,
      MONITOR_BROWSER_SERVER_PORT: String(PORT),
      [portOption]: String(PORT),
      HAIBUN_LOG_LEVEL: 'info',
      HAIBUN_STAY: 'always'
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

    await new Promise<void>((resolve, reject) => {
      let started = false;
      let buffer = '';

      hostProcess.stdout?.on('data', (data) => {
        const chunk = data.toString();
        buffer += chunk;
        if (buffer.includes(LOG_HOST_STARTED) || buffer.includes('features passed')) {
          if (!started) {
            started = true;
            resolve();
          }
        }
      });
      hostProcess.stderr?.on('data', (data) => {
        console.error('[HOST stderr]:', data.toString());
      });
      hostProcess.on('error', reject);
      hostProcess.on('exit', (code) => {
        if (!started) reject(new Error(`Host exited with code ${code}\n${buffer}`));
      });
      setTimeout(() => {
        if (!started) reject(new Error(`Host start timeout\n${buffer}`));
      }, 10000);
    });
  }, 15000);

  afterAll(() => {
    if (hostProcess) hostProcess.kill();
  });

  it('piggybacks on existing monitor and sends events', async () => {
    const portOption = getStepperOptionName(MonitorBrowserStepper, 'PORT');

    let ingested = false;
    const checkIngest = (data: Buffer) => {
      const str = data.toString();
      if (str.includes(LOG_INGESTED)) {
        ingested = true;
      }
    };
    hostProcess.stderr?.on('data', checkIngest);

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

    // Give it a moment to process the async fetch
    await new Promise(resolve => setTimeout(resolve, 2000));
    hostProcess.stderr?.off('data', checkIngest);

    expect(ingested, 'Host should have ingested events from the piggybacker').toBe(true);
  });
});
