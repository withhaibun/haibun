import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';

// `npm run build` -> `production` is true
// `npm run dev` -> `production` is false
const production = !process.env.ROLLUP_WATCH;

const addConfig = (input, output) => ({
  input: `./src/${input}`,
  output: {
    file: `${output}`,
    format: 'esm',
  },
  plugins: [
    resolve(), // tells Rollup how to find date-fns in node_modules
    typescript(),
  ],
});

const dist = `built`;
const built = `/home/vid/D/withhaibun/haibun-e2e-tests/files/published/built`;

export default [
  addConfig('index.ts', `${dist}/index.js`),
  addConfig('reviews/index.ts', `${dist}/reviews.js`),

  addConfig('index.ts', `${built}/index.js`),
  addConfig('reviews/index.ts', `${built}/reviews.js`),
];
