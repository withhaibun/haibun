import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import litcss from 'rollup-plugin-lit-css';

const dashboard = {
  input: [`./src/dashboard/index.ts`, `./src/dashboard/indexer.ts`],
  output: {
    dir: `built/dashboard/`,
  },
  plugins: [litcss(), resolve(), typescript({ outDir: './built/dashboard' })],
};

const reviewer = {
  input: `./src/reviews/index.ts`,
  output: { dir: `built/reviewer/` },
  plugins: [litcss(), resolve(), typescript({ outDir: './built/reviewer' })],
};

export default [dashboard, reviewer];
