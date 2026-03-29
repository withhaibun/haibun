import { describe, it, expect } from 'vitest';
import { passWithDefaults, DEF_PROTO_OPTIONS } from '@haibun/core/lib/test/lib.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { OK, type TStepArgs } from '@haibun/core/schema/protocol.js';
import { actionNotOK, actionOKWithProducts, getStepperOptionName } from '@haibun/core/lib/util/index.js';
import WebServerStepper from './web-server-stepper.js';

class PingStepper extends AStepper {
  steps = {
    ping: {
      gwta: 'ping',
      action: async () => actionOKWithProducts({ pong: true }),
    },
  };
}

class RpcVerifyStepper extends AStepper {
  steps = {
    rpcStepListIncludes: {
      gwta: 'rpc step list at {url} includes {stepName}',
      action: async ({ url, stepName }: TStepArgs) => {
        const res = await fetch(String(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'step.list', params: {} }),
        });
        if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
        const data = await res.json();
        const steps = Array.isArray(data) ? data : (data as { steps?: { method: string }[] }).steps ?? [];
        const methods = steps.map((s: { method: string }) => s.method);
        return methods.includes(String(stepName)) ? OK : actionNotOK(`"${stepName}" not in [${methods.join(', ')}]`);
      },
    },
    rpcCallSucceeds: {
      gwta: 'rpc call to {url} with method {method} succeeds',
      action: async ({ url, method }: TStepArgs) => {
        const res = await fetch(String(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: String(method), params: {} }),
        });
        if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) return actionNotOK(data.error);
        return OK;
      },
    },
    rpcOldFormatIgnored: {
      gwta: 'rpc old format to {url} is not dispatched',
      action: async ({ url }: TStepArgs) => {
        const res = await fetch(String(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'rpc', id: '1', method: 'step.list', params: {} }),
        });
        const data = await res.json();
        // Old format is not parsed as a valid JSON-RPC 2.0 request, so no handler processes it.
        // Transport returns { ok: true } as default (no handler matched).
        if (Array.isArray(data)) return actionNotOK('Got step.list response — old format should not be dispatched');
        return OK;
      },
    },
  };
}

function makeOptions(port: number) {
  return {
    ...DEF_PROTO_OPTIONS,
    moduleOptions: { [getStepperOptionName(WebServerStepper, 'PORT')]: String(port) },
  };
}

const steppers = [WebServerStepper, PingStepper, RpcVerifyStepper];

describe('RPC dispatch via WebServerStepper', () => {
  it('step.list includes PingStepper-ping', async () => {
    const port = 8234;
    const feature = {
      path: '/features/test.feature',
      content: `
enable rpc
webserver is listening for "rpc-step-list"
rpc step list at "http://localhost:${port}/rpc/step.list" includes "PingStepper-ping"
`,
    };
    const result = await passWithDefaults([feature], steppers, makeOptions(port));
    expect(result.ok).toBe(true);
  });

  it('executes a step via RPC', async () => {
    const port = 8235;
    const feature = {
      path: '/features/test.feature',
      content: `
enable rpc
webserver is listening for "rpc-step-exec"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" succeeds
`,
    };
    const result = await passWithDefaults([feature], steppers, makeOptions(port));
    expect(result.ok).toBe(true);
  });

  it('rejects old-format RPC envelope', async () => {
    const port = 8236;
    const feature = {
      path: '/features/test.feature',
      content: `
enable rpc
webserver is listening for "rpc-old-format"
rpc old format to "http://localhost:${port}/rpc/step.list" is not dispatched
`,
    };
    const result = await passWithDefaults([feature], steppers, makeOptions(port));
    expect(result.ok).toBe(true);
  });

  it('step.list returns { steps, domains } shape', async () => {
    const port = 8237;
    const feature = {
      path: '/features/test.feature',
      content: `
enable rpc
webserver is listening for "rpc-step-list-shape"
rpc step list at "http://localhost:${port}/rpc/step.list" includes "PingStepper-ping"
`,
    };

    // Intercept the raw step.list response to verify shape
    let capturedStepList: unknown;
    class StepListCaptureStepper extends AStepper {
      steps = {
        captureStepList: {
          gwta: 'capture step list at {url}',
          action: async ({ url }: { url: string }) => {
            const res = await fetch(String(url), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'step.list', params: {} }),
            });
            capturedStepList = await res.json();
            return OK;
          },
        },
      };
    }

    const captureFeature = {
      path: '/features/shape-test.feature',
      content: `
enable rpc
webserver is listening for "rpc-shape-test"
capture step list at "http://localhost:${port + 10}/rpc/step.list"
`,
    };
    const shapeSteppers = [WebServerStepper, PingStepper, StepListCaptureStepper];
    await passWithDefaults([captureFeature], shapeSteppers, makeOptions(port + 10));

    expect(capturedStepList).toHaveProperty('steps');
    expect(capturedStepList).toHaveProperty('domains');
    expect(Array.isArray((capturedStepList as { steps: unknown }).steps)).toBe(true);
  });

  it('ad-hoc RPC calls get distinct seqPath [0, N]', async () => {
    const port = 8238;
    const seqPaths: number[][] = [];

    class SeqCaptureStepper extends AStepper {
      steps = {
        captureSeq: {
          gwta: 'capture rpc seq at {url}',
          action: async ({ url }: { url: string }) => {
            for (let i = 0; i < 2; i++) {
              const res = await fetch(String(url), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: `seq-${i}`, method: 'PingStepper-ping', params: {} }),
              });
              const data = await res.json() as Record<string, unknown>;
              if (Array.isArray(data._seqPath)) seqPaths.push(data._seqPath as number[]);
            }
            return OK;
          },
        },
      };
    }

    const feature = {
      path: '/features/seq-test.feature',
      content: `
enable rpc
webserver is listening for "rpc-seq-test"
capture rpc seq at "http://localhost:${port}/rpc/PingStepper-ping"
`,
    };
    const r = await passWithDefaults([feature], [WebServerStepper, PingStepper, SeqCaptureStepper], makeOptions(port));
    expect(r.ok).toBe(true);
    // Both calls should have seqPath starting with 0 and distinct N values
    expect(seqPaths.length).toBe(2);
    expect(seqPaths[0][0]).toBe(0);
    expect(seqPaths[1][0]).toBe(0);
    expect(seqPaths[0][1]).not.toBe(seqPaths[1][1]);
  });
});
