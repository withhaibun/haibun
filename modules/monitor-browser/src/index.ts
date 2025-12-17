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

  // Static base path for transport (capture/DEST/key/ without seq/featn)
  static transportRoot: string | undefined;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);

    // Get the current feature's capture location
    const loc = { ...world, mediaType: EMediaTypes.html };
    this.captureRoot = await this.storage.getCaptureLocation(loc);

    // Start singleton transport if not exists
    // Use base path (capture/DEST/key/) without seq-N/featn-N so all features' artifacts are served
    if (!MonitorBrowserStepper.transport) {
      const port = parseInt(getStepperOption(this, 'PORT', world.moduleOptions) || '8080', 10);
      MonitorBrowserStepper.transportRoot = this.storage.getArtifactBasePath();
      MonitorBrowserStepper.transport = new WebSocketTransport(port, MonitorBrowserStepper.transportRoot);
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
      // Events from saveArtifact already have baseRelativePath as path
      // Just forward them to the transport for live streaming
      MonitorBrowserStepper.transport.send({ type: 'event', event });
    },
    endFeature: async () => {
      MonitorBrowserStepper.transport.send({ type: 'finalize' });

      // For serialized HTML, transform baseRelativePaths (seq-0/featn-1/image/file.png)
      // to featureRelativePaths (./image/file.png) since HTML will be in feature dir
      const transformedEvents = this.events.map(e => {
        if (e.kind === 'artifact' && 'path' in e && typeof (e as any).path === 'string') {
          const artifactPath = (e as any).path as string;
          // baseRelativePath format: seq-N/featn-N/subpath/file.ext
          // Need to strip seq-N/featn-N/ prefix for serialized HTML
          const match = artifactPath.match(/^seq-\d+\/featn-\d+\/(.*)$/);
          if (match) {
            return { ...e, path: './' + match[1] };
          }
          // If already a relative path like ./subpath/file.ext, keep it
          if (artifactPath.startsWith('./')) {
            return e;
          }
          // Otherwise prepend ./ for relative path
          return { ...e, path: './' + artifactPath };
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

    // Use topic (feature name) for filename if available, otherwise fallback
    const filename = topic ? `${topic}-${Date.now()}` : `haibun-report-${Date.now()}`;
    const saved = await this.storage.saveArtifact(filename + '.html', html, EMediaTypes.html);

    // Console log for immediate feedback (report saved locally, not emitted as artifact)
    console.log(seq);
    console.log(`${seq} ${topic} ${actualURI(saved.absolutePath)}`);
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
