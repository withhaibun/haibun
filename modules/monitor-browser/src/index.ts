import fs from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { AStepper, IHasCycles, IHasOptions, StepperKinds } from '@haibun/core/lib/astepper.js';
import { IStepperCycles, TWorld, OK, } from '@haibun/core/lib/defs.js';
import { THaibunEvent, } from '@haibun/core/lib/EventLogger.js';
import { stringOrError, getStepperOption, actualURI, maybeFindStepperFromOption } from '@haibun/core/lib/util/index.js';
import { WebSocketTransport, ITransport } from './transport.js';
import { WebSocketPrompter } from './prompter.js';
import { AStorage } from '@haibun/domain-storage/AStorage.js';
import { JITSerializer } from '@haibun/core/monitor/index.js';
import { ArtifactEvent } from '@haibun/core/schema/events.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';

export default class MonitorBrowserStepper extends AStepper implements IHasCycles, IHasOptions {
  kind = StepperKinds.MONITOR;
  static transport: ITransport;
  prompter: WebSocketPrompter | undefined;
  storage: AStorage | undefined;
  events: THaibunEvent[] = [];

  options = {
    PORT: {
      desc: 'Port for the browser monitor WebSocket server (default: 8080)',
      parse: stringOrError
    },
    [StepperKinds.STORAGE]: {
      desc: 'Storage for output',
      parse: stringOrError,
      required: true
    }
  };

  async setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.storage = maybeFindStepperFromOption(steppers, this, world.moduleOptions, StepperKinds.STORAGE);

    // Start singleton transport if not exists
    if (!MonitorBrowserStepper.transport) {
      const port = parseInt(getStepperOption(this, 'PORT', world.moduleOptions) || '8080', 10);
      MonitorBrowserStepper.transport = new WebSocketTransport(port);
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
      MonitorBrowserStepper.transport.send({ type: 'event', event });
    },
    endFeature: async () => {
      MonitorBrowserStepper.transport.send({ type: 'finalize' });

      // Serialize and save report
      const serializer = new JITSerializer();
      const jitData = serializer.serialize(this.events);

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
    if (!this.storage) {
      console.warn('[MonitorBrowser] No storage defined, skipping report save.');
      return;
    }
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
    const dir = await this.storage.ensureCaptureLocation(loc, 'monitor');
    // Use topic (feature name) for filename if available, otherwise fallback
    const filename = topic ? `${topic}-${Date.now()}` : `haibun-report-${Date.now()}`;
    const savePath = path.join(dir, filename + '.html');
    await this.storage.writeFile(savePath, html, EMediaTypes.html);

    // Emit ArtifactEvent
    const actualPath = actualURI(savePath).toString();
    const artifactEvent = ArtifactEvent.parse({
      id: 'monitor-report-' + Date.now(),
      timestamp: Date.now(),
      kind: 'artifact',
      artifactType: 'html',
      mimetype: 'text/html',
      path: actualPath,
      source: 'monitor-browser'
    });
    this.getWorld().eventLogger.emit(artifactEvent);
    // Console log for immediate feedback
    console.log(seq);
    console.log(`${seq} ${topic} ${actualPath}`);
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
      MonitorBrowserStepper.transport.send({ type: 'event', event });
    }
  }
}
