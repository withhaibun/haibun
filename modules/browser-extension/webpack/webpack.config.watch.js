const config = require('./webpack.config');

module.exports = {
	...config,
	// mode: 'development',
	watch: true,
	optimization: {
		minimize: false
	},
	watchOptions: {
		aggregateTimeout: 200,
		poll: 1000,
	},
};
