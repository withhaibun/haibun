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

`npm run build-watch`  # not needed if using top-level `build-watch`

`npm test` or `npm run test-watch`

## Developing modules and Haibun core together

To develop your own separate module while developing Haibun modules, use:

`npm link @haibun/core`

and any other modules you may need.

You can use `nx graph` to view Haibun's module graph structure.

---

This project uses NW. With great thanks to [nrwl](https://nx.dev/).
