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

Note that modules/out-review/dashboard/web requires separate test/build
commands.

Use `npm run depcruise` to view Haibun's [dependencies](dependencygraph.svg).

## Developing modules and Haibun core together

To develop your own separate module while developing Haibun modules, use:

`npx @haibun/utils -p link`

This will link every Haibun library in a repo to a locally linked Haibun repo; 
you may need to run `npm link` in each Haibun module directory first.


## Testing note

Since switching to vitest, circular dependencies have to be avoided for tests. 
Use this approach to find them for a particular file:

`npx dpdm modules/storage-mem/src/storage-mem.test.ts`