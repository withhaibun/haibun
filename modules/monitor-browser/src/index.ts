import fs from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { AStepper, IHasCycles, IHasOptions, StepperKinds } from '@haibun/core/lib/astepper.js';
import { IStepperCycles, TWorld } from '@haibun/core/lib/defs.js';
import { OK } from '@haibun/core/schema/protocol.js';
import { THaibunEvent } from '@haibun/core/schema/protocol.js';
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
  }

  cycles: IStepperCycles = {
    startExecution: async () => {
      // Send cwd to client for constructing absolute paths (e.g., VSCode links)
      if (MonitorBrowserStepper.transport) {
        MonitorBrowserStepper.transport.send({ type: 'init', cwd: process.cwd() });
      }
    },
    onEvent: async (event: THaibunEvent) => {
      this.events.push(event);
      if (MonitorBrowserStepper.transport) {
        MonitorBrowserStepper.transport.send({ type: 'event', event });
      }
    },
    endFeature: async () => {
      MonitorBrowserStepper.transport.send({ type: 'finalize' });

      const transformedEvents = this.events.map(e => {
        if (e.kind === 'artifact' && 'path' in e && typeof (e as any).path === 'string') {
          const artifactPath = (e as any).path as string;
          const match = artifactPath.match(/^featn-\d+(?:-[^/]*)?\/(.*)/);
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
      const world = this.getWorld();
      const featureLabel = (featureStart as any)?.label || world.runtime.feature || 'report';
      const topic = featureLabel.replace(/.*\//, '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');


      await this.saveSerializedReport(jitData, topic);
      this.events = [];
    },
    endExecution: async () => {
      MonitorBrowserStepper.transport.send({ type: 'finalize' });
    }
  };

  private async saveSerializedReport(jitData: string, topic: string) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const indexPath = path.join(__dirname, '..', 'dist', 'client', 'index.html');

    if (!fs.existsSync(indexPath)) {
      console.error('[MonitorBrowser] Could not find client build artifacts at', indexPath);
      return;
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Inject JIT Data
    const injection = `<script id="haibun-data" type="application/json">${jitData}</script>`;
    const bodyEndIndex = html.lastIndexOf('</body>');
    if (bodyEndIndex !== -1) {
      html = html.substring(0, bodyEndIndex) + injection + html.substring(bodyEndIndex);
    } else {
      html += injection;
    }

    const saved = await this.storage.saveArtifact('monitor.html', html, EMediaTypes.html);

    console.log(`[MonitorBrowser] Report saved: ${actualURI(saved.absolutePath)}`);
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
}
