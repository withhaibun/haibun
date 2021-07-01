[![unit tests Actions Status](https://github.com/vid/haibun/workflows/unit-tests/badge.svg)](https://github.com/vid/haibun/actions)

# haibun



The design goal of haibun is re-usable, flexible, and easy to maintain natural language (BDD inspired) tests,
that can be used with a minimum of configuration and code 
in a variety of settings and contexts.

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

So, if test.feature includes run.feature, that will includes setup.feature and run.feature before test.feature's steps.

Note that features/ (unlike backgrounds) will not include folder predecessors.

# Packages

haibun is composed of several packages that can be configured at runtime via the cli package. 
See the [modules](modules) directory.


# Development

Install lerna globally, then use `npm build`. Each module can be developed independantly using `tsc` and `npm test` options.