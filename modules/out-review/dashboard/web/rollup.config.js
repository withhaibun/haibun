/* eslint-disable no-undef */
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

const reviewer = (dir) => ({
  input: `./src/reviews/index.ts`,
  output: { dir },
  plugins: [litcss(), resolve(), typescript({ outDir: dir })],
});

const builds = [dashboard, reviewer('built/reviewer')];
// export DASHBOARD_PREVIEW="$HOME/D/withhaibun/haibun-e2e-tests/files/published/built/reviewer"
if (process.env.DASHBOARD_PREVIEW) {
  builds.push(reviewer(process.env.DASHBOARD_PREVIEW));
}
export default builds;
