# Developing Haibun

Clone this repo, then install and build:

`npm install ` - this will also do a first build via npm prepare

During development of modules, use

`npm run build-watch`

Top level tests for all modules are also available:

`npm run test`

or

`npm run test-watch`


The same build/test commands are available in individual modules, but are not needed if running the command in the main directory.

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
