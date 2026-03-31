# Shu State

## Current Position

The Shu test structure is now under `tests/features/*.feature.ts` with `tests/config.json` driving the module-local e2e run.

The current tutorial feature is [tests/features/hypermedia.feature.ts](/home/vid/Private/D/dev/withhaibun/haibun/modules/shu/tests/features/hypermedia.feature.ts). It now includes `enable rpc` before `serve shu app at "/spa"`, which was required so `/rpc/step.list` returns real discovery metadata instead of the default `{ ok: true }` fallback.

## Completed

- Strict path enforcement is implemented in [src/shu-stepper.ts](/home/vid/Private/D/dev/withhaibun/haibun/modules/shu/src/shu-stepper.ts).
- `serveShuApp` now validates mount paths.
- `serveShuApp` now supports exactly one mount per `ShuStepper` instance.
- Reusing the same path or attempting a second different path now fails explicitly.
- Regression coverage exists in [src/shu-stepper.test.ts](/home/vid/Private/D/dev/withhaibun/haibun/modules/shu/src/shu-stepper.test.ts).

## Verified

- `npm run build` passes in `haibun/modules/shu`.
- `npx vitest run modules/shu/src/shu-stepper.test.ts` passes from the `haibun` root.
- The e2e runner starts correctly with the module-local command from [package.json](/home/vid/Private/D/dev/withhaibun/haibun/modules/shu/package.json).
- The browser reaches `http://localhost:8237/spa?label=Researcher`.

## Active Blocker

The Shu e2e flow is still failing before the first visible results render.

Current failing step:

- `wait for query-table`

Observed runtime error from the latest e2e run:

- `TutorialGraphStepper-graphQuery validation failed: "label": required, "textQuery": required`

Effect:

- The SPA loads.
- The page settles.
- The query RPC fails.
- `query-table` never renders, so the first UI assertion fails.

## Root Cause

There is still a contract mismatch between the Shu SPA and the tutorial graph stepper.

The SPA sends `graphQuery` as a structured RPC payload shaped like:

```ts
{ query: { label, filters, textQuery, sortBy, sortOrder, limit, offset } }
```

But the current `graphQuery` action in [src/tutorial-graph-stepper.ts](/home/vid/Private/D/dev/withhaibun/haibun/modules/shu/src/tutorial-graph-stepper.ts) still executes against top-level arguments shaped like:

```ts
{ label, textQuery, limit, offset }
```

The file already contains a `GraphQuerySchema` with the nested `query` shape, but that schema is not yet wired into the actual step contract used by RPC dispatch.

## Next Fix

Align `TutorialGraphStepper.graphQuery` with the SPA request shape so the RPC endpoint accepts the same object the UI sends.

Most likely change:

- Accept `{ query }` in the action.
- Read `label`, `textQuery`, `limit`, and `offset` from `query`.
- Preserve compatibility with the feature helper if needed, or switch the feature usage to the same structured shape.

## Last Known E2E Result

Latest command run:

```bash
cd /home/vid/Private/D/dev/withhaibun/haibun/modules/shu && timeout 90 npm run test:e2e
```

Latest terminal outcome:

- RPC is enabled.
- SPA is served.
- `graphQuery` RPC validation fails.
- E2E stops at `wait for query-table`.
