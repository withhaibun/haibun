# Developing Haibun

Clone this repo, then install and build:

`npm i` (this will trigger npm run clean, npm install)

`npm run build-watch`

Use this at the top level to build and watch all modules.

Top level tests for all modules are also available:

`npm run test`

or

`npm run test-watch`

Each module can be developed independently using:

`npm run build-watch` # not needed if using top-level `build-watch`

`npm test` or `npm run test-watch`

You may need to `export NODE_OPTIONS=--experimental-vm-modules`.

## Developing modules and Haibun core together

To develop your own separate module while developing Haibun modules, use:

`npm link @haibun/core`

and any other modules you may need.

You can use `nx graph` to view Haibun's module graph structure.

---

## Handlers

Haibun supports stepper handlers for consistency in handling events. Steppers can implement `IHasHandlers`.
Here's an exapmle:

```
export const HANDLE_RESULT_HISTORY = 'handleResultHistory';

export interface IHandleResultHistory extends ISourcedHandler {
  handle(args: TTypes)  : TReturnType
}

```

elsewhere:

```
      const historyHandlers = findHandlers<IHandleResultHistory>(steppers, HANDLE_RESULT_HISTORY);
```
Handlers support a `usage` property, which can be `HANDLER_USAGE.FALLBACK` (only used if no others exist) 
or `HANDLER_USAGE.EXCLUSIVE``.
