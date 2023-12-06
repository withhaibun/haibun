# Developing Haibun

Clone this repo, then install and build:

`npm i`

`npm run build`

During development of modules, use

`npm run build-watch`

Top level tests for all modules are also available:

`npm run test`

or

`npm run test-watch`


The same build/test commands are available in individual modules, but are not needed if running the command in the main directory.

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