/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    includeOnly: "^modules",

    // Exclude the build directories
    exclude: {
      path: [
        "modules/.*/build",
        "modules/out-review/dashboard"]
    },

    prefix: "https://github.com/withhaibun/haibun/tree/main/",

    tsPreCompilationDeps: true,

    tsConfig: {
      fileName: "./modules/tsconfig.json",
    },

    progress: { type: "performance-log" },

    reporterOptions: {
      dot: {
        theme: {
          graph: {
            splines: "ortho"
          },
          modules: [
            {
              criteria: { source: "\\.spec\\.(j|t)sx?$" },
              attributes: {
                shape: "hexagon"
              }
            },
          ],
          dependencies: [
            // default dependency color (when none of the below apply):
            {
              criteria: {
              },
              attributes: {
                fontcolor: "blue",
                color: "blue",
              },
            },
            {
              criteria: { resolved: '^modules/.*(constants|config|types)' },
              attributes: {
                style: 'dashed',
                fontcolor: 'gray',
                color: 'gray',
              },
            },
            {
              criteria: { dependencyTypes: ['local'] },
              attributes: {
                color: 'red',
              },
            },
            {
              criteria: { dynamic: true },
              attributes: {
                color: 'green',
                style: 'dotted',
              },
            },
            {
              criteria: { preCompilationOnly: true },
              attributes: {
                color: '#000088',
                style: 'dotted',
              },
            },
            {
              criteria: { valid: false },
              attributes: {
                color: 'red',
                style: 'bold',
              },
            },
          ],
        },
      },
    }
  },
};