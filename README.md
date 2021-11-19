[![unit tests Actions Status](https://github.com/vid/haibun/workflows/unit-tests/badge.svg)](https://github.com/vid/haibun/actions)

# haibun

Haibun is inspired by the literary form that combines descriptive and objective prose with haiku.

This package is intended to enable specification driven development, with end to end tests. 
This type of development is often tedious to develop, 
brittle to changing underlying implementations,
difficult to maintain, 
and isolated from general specifications.
While @Haibun may not make this development fun, 
it is intended to make it easier to maintain, 
with an emphasis on reuse for different deployment environments,
and the ability to link to formal specifications.


# Feature structure

```
project/
  features/
    test.feature
  backgrounds/
    setup.feature
      dependant/
      run.feature
```

On running tests, features at the project/ level are run. 

Features can use the directive `Backgrounds: <features>` or `Scenarios: <features>` which will prepend comma-separated named features from backgrounds/.
Background features from further 'down' their tree will include previous features.

So, if test.feature includes run.feature, 
that will includes setup.feature and run.feature before test.feature's steps.

Note that features/ (unlike backgrounds) will not include folder predecessors.

# Packages

haibun is composed of a number of packages, 
each with minimum dependencies, 
which can be configured at runtime via the cli package. 

See the [modules](modules) directory.

# Installation

The installation uses a shell script, it is tested in Linux & macOS, and should also work on Windows using WSL.

Clone this repo, and install lerna and typescript globally;

  `npm i -g lerna typescript`

  
# Development

To build:

  `npm run build`
  `npm run tsc-watch`

Use this at the top level to build and watch all modules.

Each module can be developed independently using: 

  `npm run tsc-watch` 

  `npm test`

To develop your own separate module while developing these Haibun modules, use:

`npm link @haibun/core`

and any other modules you may need.
