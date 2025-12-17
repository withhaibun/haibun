import fs from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { AStepper, IHasCycles, IHasOptions, StepperKinds } from '@haibun/core/lib/astepper.js';
import { IStepperCycles, TWorld, OK, } from '@haibun/core/lib/defs.js';
import { THaibunEvent, } from '@haibun/core/lib/EventLogger.js';
import { stringOrError, getStepperOption, actualURI, findStepperFromOptionOrKind } from '@haibun/core/lib/util/index.js';
import { WebSocketTransport, ITransport } from './transport.js';
import { WebSocketPrompter } from './prompter.js';
import { AStorage } from '@haibun/domain-storage/AStorage.js';
import { JITSerializer } from '@haibun/core/monitor/index.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';

export default class MonitorBrowserStepper extends AStepper implements IHasCycles, IHasOptions {
  kind = StepperKinds.MONITOR;
  static transport: ITransport;
  prompter: WebSocketPrompter | undefined;
  storage!: AStorage;
  events: THaibunEvent[] = [];

  options = {
    PORT: {
      desc: 'Port for the browser monitor WebSocket server (default: 8080)',
      parse: stringOrError
    },
    [StepperKinds.STORAGE]: {
      desc: 'Storage for output',
      parse: stringOrError,
    }
  };

  captureRoot: string | undefined;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);

    // Start singleton transport if not exists
    if (!MonitorBrowserStepper.transport) {
      const port = parseInt(getStepperOption(this, 'PORT', world.moduleOptions) || '8080', 10);
      const loc = { ...world, mediaType: EMediaTypes.html };
      this.captureRoot = await this.storage.getCaptureLocation(loc);
      MonitorBrowserStepper.transport = new WebSocketTransport(port, this.captureRoot);
    }

    // Setup debugger bridge
    this.prompter = new WebSocketPrompter(MonitorBrowserStepper.transport);
    world.prompter.subscribe(this.prompter);

    world.eventLogger.setStepperCallback((event: THaibunEvent) => {
      this.onEvent(event);
    });
  }

  cycles: IStepperCycles = {
    onEvent: async (event: THaibunEvent) => {
      // Transform for live mode (similar to endFeature serialization logic)
      let transportEvent = event;
      if (this.captureRoot && event.kind === 'artifact' && 'path' in event && typeof (event as any).path === 'string') {
        const artifactPath = (event as any).path as string;
        let absPath = artifactPath;
        if (artifactPath.startsWith('file://')) {
          absPath = fileURLToPath(artifactPath);
        }

        // If path is absolute, try to make it relative to captureRoot
        // This handles cases where artifacts are deep in subdirectories
        if (path.isAbsolute(absPath)) {
          const relPath = path.relative(this.captureRoot, absPath);
          // If it is inside captureRoot (doesn't start with ..)
          if (!relPath.startsWith('..') && !path.isAbsolute(relPath)) {
            // Normalize to URL slashes
            const urlPath = relPath.split(path.sep).join('/');
            if (urlPath && urlPath !== '.') {
              transportEvent = { ...event, path: urlPath };
            }
          }
        }
      }
      MonitorBrowserStepper.transport.send({ type: 'event', event: transportEvent });
    },
    endFeature: async () => {
      MonitorBrowserStepper.transport.send({ type: 'finalize' });

      // Transform artifact paths to be relative to capture directory
      // Paths should already be relative like ./image/screenshot.png
      const transformedEvents = this.events.map(e => {
        if (e.kind === 'artifact' && 'path' in e && typeof (e as any).path === 'string') {
          const artifactPath = (e as any).path as string;
          let absPath = artifactPath;

          if (artifactPath.startsWith('file://')) {
            absPath = fileURLToPath(artifactPath);
          }

          // If we have captureRoot and path is absolute, make it relative
          if (this.captureRoot && path.isAbsolute(absPath)) {
            const relPath = path.relative(this.captureRoot, absPath);
            if (!relPath.startsWith('..')) {
              // Normalize for URL usage in HTML
              const urlPath = relPath.split(path.sep).join('/');
              if (urlPath && urlPath !== '.') {
                return { ...e, path: urlPath };
              }
            }
          }

          // Fallback: if still absolute or outside captureRoot, try to use filename 
          // (Legacy behavior, but risky if name collision)
          if (path.isAbsolute(absPath)) {
            return { ...e, path: path.basename(absPath) };
          }
        }
        return e;
      });

      // Serialize and save report  
      const serializer = new JITSerializer();
      const jitData = serializer.serialize(transformedEvents);

      const featureStart = this.events.find(e => e.kind === 'lifecycle' && e.type === 'feature' && e.stage === 'start');
      const topic = featureStart && (featureStart as any).label ? (featureStart as any).label.replace(/[^a-zA-Z0-9-_]/g, '_') : 'feature';
      const seq = featureStart ? featureStart.id : 'unknown';

      await this.saveSerializedReport(jitData, topic, seq);
      this.events = [];
    },
    endExecution: async () => {
      MonitorBrowserStepper.transport.send({ type: 'finalize' });
    }
  };

  private async saveSerializedReport(jitData: string, topic: string, seq: string) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const distDir = path.join(__dirname, '..', 'dist', 'client');
    const indexPath = path.join(distDir, 'index.html');

    if (!fs.existsSync(indexPath)) {
      console.error('[MonitorBrowser] Could not find client build artifacts at', indexPath);
      return;
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Inline CSS
    // <link rel="stylesheet" crossorigin href="/assets/index-8Q2E4qDt.css">
    html = html.replace(/<link rel="stylesheet"[^>]*href="\/assets\/([^"]+)"[^>]*>/g, (match, filename) => {
      const assetPath = path.join(distDir, 'assets', filename);
      if (fs.existsSync(assetPath)) {
        const css = fs.readFileSync(assetPath, 'utf-8');
        return `<style>${css}</style>`;
      }
      return match;
    });

    // Inline JS
    // <script type="module" crossorigin src="/assets/index-DeEStOg1.js"></script>
    html = html.replace(/<script type="module"[^>]*src="\/assets\/([^"]+)"[^>]*><\/script>/g, (match, filename) => {
      const assetPath = path.join(distDir, 'assets', filename);
      if (fs.existsSync(assetPath)) {
        const js = fs.readFileSync(assetPath, 'utf-8');
        // remove module type allows it to run as standard script if logical, 
        // but Vite modules usually need type="module". 
        // Embedding module script inline works in modern browsers.
        return `<script type="module">${js}</script>`;
      }
      return match;
    });

    // Inject JIT Data
    // Place it before the closing body tag or scripts
    const injection = `<script id="haibun-data" type="application/json">${jitData}</script>`;
    // Use lastIndexOf to avoid matching inside minified JS strings
    const bodyEndIndex = html.lastIndexOf('</body>');
    if (bodyEndIndex !== -1) {
      html = html.substring(0, bodyEndIndex) + injection + html.substring(bodyEndIndex);
    } else {
      html += injection;
    }

    const loc = { ...this.getWorld(), mediaType: EMediaTypes.html };
    // Write directly to capture base directory (not a subdirectory)
    const dir = await this.storage.getCaptureLocation(loc);
    await this.storage.ensureDirExists(dir);
    // Use topic (feature name) for filename if available, otherwise fallback
    const filename = topic ? `${topic}-${Date.now()}` : `haibun-report-${Date.now()}`;
    const savePath = path.join(dir, filename + '.html');
    await this.storage.writeFile(savePath, html, EMediaTypes.html);

    // Console log for immediate feedback (report saved locally, not emitted as artifact)
    console.log(seq);
    console.log(`${seq} ${topic} ${actualURI(savePath)}`);
  }

  steps = {
    pause: {
      gwta: 'pause browser monitor',
      action: async () => {
        // Implement pause logic if needed
        return OK;
      }
    }
  };

  onEvent(event: THaibunEvent) {
    this.events.push(event);
    if (MonitorBrowserStepper.transport) {
      // Call cycle logic if simplified? No, directly call transport logic here or rely on cycles.onEvent?
      // MonitorBrowserStepper routes through cycles.onEvent via world.eventLogger callback?
      // No, setStepperCallback calls this.onEvent(event) which is defined at end of class.
      // But this.cycles.onEvent is ALSO defined?
      // The class structure is a bit mapped.
      // The setWorld callback calls `this.onEvent`.
      // `this.onEvent` is defined at line 175.
      // `this.cycles.onEvent` is defined at line 61.

      // I should update `this.onEvent` (at bottom) OR `this.cycles.onEvent`?
      // Usually `stepper.onEvent` is not a standard lifecycle method, `cycles.onEvent` is.
      // But lines 50-52: `world.eventLogger.setStepperCallback((e) => this.onEvent(e))` calls the method at line 175.

      this.cycles.onEvent(event);
    }
  }
}
