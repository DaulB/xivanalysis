/* global require, module */
const assert = require('assert')
const _ = require('lodash')
const glob = require('glob')
const {injectBabelPlugin, getBabelLoader} = require('react-app-rewired')
const rewireEslint = require('react-app-rewire-eslint')
const rewireLodash = require('react-app-rewire-lodash')
const webpack = require('webpack')

const packageJson = require('./package.json')

module.exports = (config, env) => {
	// Pull in all the locale files
	const localeFiles = glob.sync('./locale/*/messages.json')
	const localeKeyRegex = /\/(\w{2})\/messages/
	const localeCount = {}
	localeFiles.forEach(file => {
		const localeKey = localeKeyRegex.exec(file)[1]
		const data = require(file)
		localeCount[localeKey] = Object.values(data)
			.reduce((carry, value) => carry + (value? 1 : 0), 0)
	})

	// Calculate the completion
	const sourceLocale = packageJson.lingui.sourceLocale
	const localeCompletion = _.reduce(localeCount, (carry, value, key) => {
		carry[key] = ((value / localeCount[sourceLocale]) * 100).toFixed(0)
		return carry
	}, {})

	// Add the completion%s to the environment
	config.plugins = (config.plugins || []).concat([
		new webpack.DefinePlugin({
			'process.env.LOCALE_COMPLETION': localeCompletion,
		}),
	])

	// Rest of the rewires
	config = rewireEslint(config, env)
	config = rewireLodash(config, env)

	config = injectBabelPlugin('@lingui/babel-plugin-transform-js', config)
	config = injectBabelPlugin('./locale/babel-plugin-transform-react', config)

	// Set up TypeScript
	const loader = getBabelLoader(config.module.rules)
	assert.equal(loader.test.toString(), String.raw`/\.(js|mjs|jsx)$/`)
	loader.test = /\.(js|mjs|jsx|tsx?)$/
	assert.equal(typeof loader.use, 'undefined')
	assert.equal(typeof loader.loader, 'string')
	loader.use = [
		{
			loader: loader.loader,
			options: loader.options,
		},
		{
			loader: 'ts-loader',
			options: {
				// TODO: set up happyPackMode et al
				onlyCompileBundledFiles: true,
			},
		},
	]
	delete loader.loader
	delete loader.options

	config.resolve.extensions.unshift('.tsx', '.ts')
	// remove unnecessary "index.js" from the path that would be resolved by webpack anyway
	// allows a potential conversion to .ts
	config.entry = config.entry.map(file => file.replace(/[/\\]index\.js$/, ''))

	// We have to set the type for lingui files here, rather than doing
	// it inline when we import the files, because webpack 4 decided
	// it would be "helpful" and support JSON by default.
	// Whether you want it to or not.
	config.module.rules.unshift({
		type: 'javascript/auto',
		test: /locale.+\.json$/,
		loader: '@lingui/loader',
	})

	// Tweaking chunk splitting so intl polyfill doens't get pulled in
	config.optimization.splitChunks.chunks = chunk => {
		if (!chunk.name) { return true }
		return !chunk.name.includes('nv-')
	}

	return config
}
