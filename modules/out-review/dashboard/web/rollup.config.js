/* eslint-disable no-undef */
import { readFileSync } from 'fs';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import litcss from 'rollup-plugin-lit-css';
import license from 'rollup-plugin-license';

const licensed = license({
  sourcemap: true,
  banner: {
    content: {
      file: './banner',
      encoding: 'utf-8',
    },
    data: JSON.parse(readFileSync('../../package.json', 'utf-8')),
  },
  thirdParty: {
    includePrivate: true,
    output: {
      file: './build/third-party-licenses.txt',
      encoding: 'utf-8',
    },
  },
});
const dashboard = {
  input: [`./src/dashboard/index.ts`, `./src/dashboard/indexer.ts`],
  output: {
    sourcemap: true,
    dir: `build/dashboard`,
  },
  plugins: [licensed, litcss(), resolve(), typescript({ outputToFilesystem: true, outDir: './build/dashboard' })],
};

const reviewer = (dir) => ({
  input: `./src/reviews/index.ts`,
  output: {
    dir,
    sourcemap: true,
  },
  plugins: [licensed, litcss(), resolve(), typescript({ outputToFilesystem: true, outDir: dir })],
});

const builds = [dashboard, reviewer('build/reviewer')];
// export DASHBOARD_PREVIEW="$HOME/D/withhaibun/haibun-e2e-tests/reviews/build/reviewer"
if (process.env.DASHBOARD_PREVIEW) {
  console.log(`Building for preview at ${process.env.DASHBOARD_PREVIEW}`);
  builds.push(reviewer(process.env.DASHBOARD_PREVIEW));
}
export default builds;
