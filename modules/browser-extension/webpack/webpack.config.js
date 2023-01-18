const path = require('path');
module.exports = {
	mode: "production",
	target: 'node',
	entry: {
		// index: path.resolve(__dirname, "..", "src", "index.ts"),
		// wrapper: path.resolve(__dirname, "..", "src/background/", "wrapper"),
		background: path.resolve(__dirname, "..", "src/background/", "index"),
		popup: path.resolve(__dirname, "..", "src/popup/", "index"),
		content: path.resolve(__dirname, "..", "src/content/", "index")
	},
	output: {
		path: path.join(__dirname, "../public/js"),
		filename: "[name].js",
	},
	resolve: {
		extensions: [".ts", ".js"]
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				loader: "ts-loader",
				exclude: /node_modules/,
			},
		],
	},
};
