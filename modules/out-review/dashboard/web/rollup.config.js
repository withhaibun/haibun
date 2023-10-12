import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';

// `npm run build` -> `production` is true
// `npm run dev` -> `production` is false
const production = !process.env.ROLLUP_WATCH;

export default {
	input: 'src/reviews/index.ts',
	output: {
		file: 'built/reviews.js',
		sourcemap: true
	},
	plugins: [
		resolve(), // tells Rollup how to find date-fns in node_modules
		typescript()
	]
	
};
