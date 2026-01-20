import { describe, it, expect, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { passWithDefaults } from '@haibun/core/lib/test/lib.js';
import Haibun from '@haibun/core/steps/haibun.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import MonitorBrowserStepper from './monitor-browser-stepper.js';
import StorageFS from '@haibun/storage-fs/storage-fs.js';
import WebPlaywright from '@haibun/web-playwright/web-playwright.js';
import { getStepperOptionName } from '@haibun/core/lib/util/index.js';

/**
 * Integration test for artifact serving via the /featn-* route.
 * Uses passWithDefaults with WebPlaywright to take a screenshot and verify serving.
 */
describe('Artifact Serving Integration', () => {
  const testPort = 44200 + Math.floor(Math.random() * 100);
  const testId = `artifact-test-${Date.now()}`;
  const testHtmlDir = path.join(os.tmpdir(), testId);
  const testHtml = path.join(testHtmlDir, 'test.html');
  // Capture goes to ./capture/DEST/key/featn-N, so we use testId as DEST
  const captureDir = path.join(process.cwd(), 'capture', testId);

  afterAll(() => {
    // Reset transport for other tests
    MonitorBrowserStepper.transport = undefined;

    if (fs.existsSync(testHtmlDir)) {
      fs.rmSync(testHtmlDir, { recursive: true, force: true });
    }
    if (fs.existsSync(captureDir)) {
      fs.rmSync(captureDir, { recursive: true, force: true });
    }
  });

  it('serves screenshot artifacts via /featn-* route', async () => {
    // Create test HTML file
    fs.mkdirSync(testHtmlDir, { recursive: true });
    fs.writeFileSync(testHtml, '<html><body><h1>Artifact Test</h1></body></html>');

    const feature = {
      path: '/features/artifact-test.feature',
      content: `Feature: Artifact Serving Test
      
        Scenario: Take a screenshot
        go to the file://${testHtml} webpage
        take a screenshot`
    };

    const portOption = getStepperOptionName(MonitorBrowserStepper.prototype, 'PORT');
    const headlessOption = getStepperOptionName(WebPlaywright.prototype, 'HEADLESS');

    const result = await passWithDefaults(
      [feature],
      [Haibun, VariablesStepper, MonitorBrowserStepper, StorageFS, WebPlaywright],
      {
        options: {
          DEST: testId,
        },
        moduleOptions: {
          [portOption]: String(testPort),
          [headlessOption]: 'true',
        }
      }
    );

    expect(result.ok).toBe(true);

    // Find screenshot files in the capture directory
    // Path structure: ./capture/DEST/key/featn-N/image/event-*.png
    expect(fs.existsSync(captureDir)).toBe(true);

    // Find the key directory (timestamp-based)
    const keyDirs = fs.readdirSync(captureDir);
    expect(keyDirs.length).toBeGreaterThan(0);

    const keyDir = path.join(captureDir, keyDirs[0]);
    const featnDirs = fs.readdirSync(keyDir).filter(d => d.startsWith('featn-'));
    expect(featnDirs.length).toBeGreaterThan(0);

    const featnDir = path.join(keyDir, featnDirs[0]);
    const imageDir = path.join(featnDir, 'image');

    expect(fs.existsSync(imageDir)).toBe(true);
    const images = fs.readdirSync(imageDir).filter(f => f.endsWith('.png'));
    expect(images.length).toBeGreaterThan(0);

    // Verify the artifact can be fetched via the /featn-* route
    // Path format: /featn-N-slug/image/filename.png
    const imagePath = `${featnDirs[0]}/image/${images[0]}`;
    const url = `http://127.0.0.1:${testPort}/${imagePath}`;

    const response = await fetch(url);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('image');

    // Verify it's actual image data (PNG starts with specific bytes)
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    expect(bytes.length).toBeGreaterThan(100);
    // PNG magic bytes: 137 80 78 71
    expect(bytes[0]).toBe(137);
    expect(bytes[1]).toBe(80);
  });
});
