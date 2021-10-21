import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";
import typescript from '@rollup/plugin-typescript';

export default [
  {
    input: "src/WebComponentBuilder.ts",
    output: [
      {
        dir: "lib",
        format: "cjs",
      },
    ],
    preserveEntrySignatures: false,
    external: ["solid-js", "solid-js/web", "path", "express"],
    plugins: [
      nodeResolve({
        preferBuiltins: true,
        exportConditions: ["solid", "node"],
      }),
      typescript({
      }),
      babel({
        babelHelpers: "bundled",
        presets: [["solid", { generate: "ssr", hydratable: true }]],
      }),
      common(),
    ],
  },
  {
    input: "src/index.js",
    output: [
      {
        dir: "public/js",
        format: "esm",
      },
    ],
    preserveEntrySignatures: false,
    plugins: [
      nodeResolve({ exportConditions: ["solid"] }),
      typescript({
        useTsconfigDeclarationDir: true,
        tsconfigOverride: {
        },
      }),
      common(),
      babel({
        babelHelpers: "bundled",
        presets: [["solid", { generate: "dom", hydratable: true }]],
      }),
      copy({
        targets: [
          {
            src: ["static/*"],
            dest: "public",
          },
        ],
      }),
    ],
  },
];
