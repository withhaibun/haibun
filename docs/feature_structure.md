
# Feature structure

```
project/
  config.json
  features/
    test.feature
    ...
  backgrounds/
    setup.feature
      dependant/
      run.feature
```

The haibun cli requires a folder parameter, which would be `project` in the above example.

Features can use the directive `Backgrounds: <features>` or `Scenarios: <features>` 
which will prepend comma-separated named features from backgrounds/.
Background features from further 'down' their tree will include previous features.

So, if test.feature includes run.feature, 
that will includes setup.feature and run.feature before test.feature's steps.

Note that features/ (unlike backgrounds) will not include folder predecessors.

Haibun modules are specified in the project package.json, and a config.json file with specific features.