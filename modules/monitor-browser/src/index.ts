import { AStepper, IHasCycles, IHasOptions, TStepperSteps, TStepperKind } from '@haibun/core/lib/astepper.js';
import { IStepperCycles, TWorld, OK, TActionResult } from '@haibun/core/lib/defs.js';
import { THaibunEvent, IEventLogger } from '@haibun/core/lib/EventLogger.js';
import { stringOrError, getStepperOption, findStepperFromOption, actualURI } from '@haibun/core/lib/util/index.js';
import { WebSocketTransport, ITransport } from './transport.js';
import { WebSocketPrompter } from './prompter.js';
import fs from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { AStorage } from '@haibun/domain-storage/AStorage.js';
import { JITSerializer } from '@haibun/core/monitor/index.js';
import { ArtifactEvent } from '@haibun/core/schema/events.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';


export default class MonitorBrowserStepper extends AStepper implements IHasCycles, IHasOptions {
  kind: TStepperKind = 'monitor';
  static transport: ITransport | undefined;
  prompter: WebSocketPrompter | undefined;
  storage: AStorage | undefined;
  static STORAGE = 'STORAGE';
  events: THaibunEvent[] = [];

  options = {
    PORT: {
      desc: 'Port for the browser monitor WebSocket server (default: 8080)',
      parse: stringOrError
    },
    [MonitorBrowserStepper.STORAGE]: {
      desc: 'Storage for output',
      parse: stringOrError,
      required: true
    }
  };

  async setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.storage = findStepperFromOption(steppers, this, world.moduleOptions, MonitorBrowserStepper.STORAGE);

    const GLOBAL_TRANSPORT_KEY = '__HAIBUN_MONITOR_TRANSPORT__';


    // Start singleton transport if not exists
    if (!(globalThis as any)[GLOBAL_TRANSPORT_KEY]) {
      try {
        const port = parseInt(getStepperOption(this, 'PORT', world.moduleOptions) || '8080', 10);
        (globalThis as any)[GLOBAL_TRANSPORT_KEY] = new WebSocketTransport(port);
      } catch (e: any) {
        if (e.code === 'EADDRINUSE') {
          console.log('Monitor Browser: Port 8080 already in use, assuming external monitor or parallel run.');
          // We can't easily get the reference if it's external, but if it's internal we should have found it.
          // If it's internal but we missed it (race?), we are stuck.
          // But global check should catch it.
        } else {
          throw e;
        }
      }
    }

    // Retrieve singleton
    MonitorBrowserStepper.transport = (globalThis as any)[GLOBAL_TRANSPORT_KEY];

    // If we still don't have transport (e.g. EADDRINUSE caught but no ref), we can't send events.
    // But let's assume valid flow.
    // If we still don't have transport (e.g. EADDRINUSE caught but no ref), we can't send events.
    // But let's assume valid flow.
    const transport = MonitorBrowserStepper.transport;


    if (transport) {
      // Setup debugger bridge
      this.prompter = new WebSocketPrompter(transport);
      world.prompter.subscribe(this.prompter);
    }

    world.eventLogger.setStepperCallback((event: THaibunEvent) => {
      this.onEvent(event);
    });
  }

  cycles: IStepperCycles = {
    onEvent: async (event: THaibunEvent) => {
      // Forward all events to the browser client
      if (MonitorBrowserStepper.transport) {
        MonitorBrowserStepper.transport.send({ type: 'event', event });
      }
    },
    endFeature: async () => {
      if (MonitorBrowserStepper.transport) {
        MonitorBrowserStepper.transport.send({ type: 'finalize' });
      }

      // Serialize and save report
      const serializer = new JITSerializer();
      const jitData = serializer.serialize(this.events);

      // Infer topic from events (e.g. feature name)
      // We can look for the first feature start event
      const featureStart = this.events.find(e => e.kind === 'lifecycle' && e.type === 'feature' && e.stage === 'start');
      const topic = featureStart && (featureStart as any).label ? (featureStart as any).label.replace(/[^a-zA-Z0-9-_]/g, '_') : 'feature';
      const seq = featureStart ? featureStart.id : 'unknown';

      await this.saveReport(jitData, topic, seq);
      this.events = [];
    },
    endExecution: async () => {
      if (MonitorBrowserStepper.transport) {
        MonitorBrowserStepper.transport.send({ type: 'finalize' });
      }
    }
  };

  private async saveReport(jitData: string, topic: string, seq: string) {
    try {
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

      if (this.storage) {
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
        console.log(`${seq} ${topic} ${actualPath}`);
      } else {
        console.warn('[MonitorBrowser] No storage defined, skipping report save.');
      }
    } catch (e) {
      console.error('[MonitorBrowser] Failed to save report', e);
    }
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
