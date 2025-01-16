import { Context } from '../lib/contexts.js';
import { OK, TNamed, TFeatureStep, TWorld, TActionResultTopics, AStepper } from '../lib/defs.js';
import { actionNotOK } from '../lib/util/index.js';

// FIXME see https://github.com/withhaibun/haibun/issues/18
const getOrCond = (fr: string) => fr.replace(/.* is set or /, '');

const vars = class Vars extends AStepper {
	set = async (named: TNamed, vstep: TFeatureStep) => {
		// FIXME see https://github.com/withhaibun/haibun/issues/18
		const emptyOnly = !!vstep.in.match(/set empty /);

		const res = setShared(named, vstep, this.getWorld(), emptyOnly);
		return res;
	};
	isSet(what: string, orCond: string) {
		if (this.getWorld().shared.get(what) !== undefined) {
			return OK;
		}
		const [warning, response] = orCond.split(':').map((t) => t.trim());
		const topics: TActionResultTopics = {
			warning: { summary: warning },
		};

		if (response) {
			topics.response = { summary: response };
		}

		return actionNotOK(`${what} not set${orCond && ': ' + orCond}`, { score: 10, topics });
	}

	steps = {
		concat: {
			gwta: 'concat {p1} and {p2} as {what}',
			action: async ({ p1, p2, what }: TNamed, vstep: TFeatureStep) => await this.set({ what, value: `${p1}${p2}` }, vstep),
		},
		showEnv: {
			gwta: 'show env',
			action: async (n: TNamed, vstep: TFeatureStep) => {
				console.info('env', this.world.options.env);
				return await this.set(n, vstep);
			},
			build: async (n: TNamed, vstep: TFeatureStep) => await this.set(n, vstep),
		},
		showVars: {
			gwta: 'show vars',
			action: async (n: TNamed, vstep: TFeatureStep) => {
				console.info('vars', this.world.shared);
				return await this.set(n, vstep);
			},
			build: async (n: TNamed, vstep: TFeatureStep) => await this.set(n, vstep),
		},
		set: {
			gwta: 'set( empty)? {what: string} to {value: string}',
			action: async (n: TNamed, vstep: TFeatureStep) => {
				return await this.set(n, vstep);
			},
			build: async (n: TNamed, vstep: TFeatureStep) => await this.set(n, vstep),
		},
		is: {
			gwta: '{what: string} is "{value}"',
			action: async ({ what, value }: TNamed) => {
				const val = this.getWorld().shared.get(what);
				return val === value ? OK : actionNotOK(`${what} is ${val}, not ${value}`);
			},
		},
		isSet: {
			gwta: '{what: string} is set( or .*)?',

			action: async ({ what }: TNamed, vstep: TFeatureStep) => this.isSet(what, getOrCond(vstep.in)),
			build: async ({ what }: TNamed, vstep: TFeatureStep) => this.isSet(what, getOrCond(vstep.in)),
		},
		background: {
			match: /^Background: ?(?<background>.+)?$/,
			action: async ({ background }: TNamed) => {
				this.getWorld().shared.set('background', background);
				return OK;
			},
		},
		feature: {
			match: /^Feature: ?(?<feature>.+)?$/,
			action: async ({ feature }: TNamed) => {
				this.getWorld().shared.set('feature', feature);
				return OK;
			},
		},
		scenario: {
			match: /^Scenario: (?<scenario>.+)$/,
			action: async ({ scenario }: TNamed) => {
				this.getWorld().shared.set('scenario', scenario);
				return OK;
			},
		},
		display: {
			gwta: 'display {what}',
			action: async ({ what }: TNamed) => {
				this.getWorld().logger.log(`is ${JSON.stringify(what)}`);

				return OK;
			},
		},
	};
};
export default vars;

export const didNotOverwrite = (what: string, present: string | Context, value: string) => ({
	overwrite: { summary: `did not overwrite ${what} value of "${present}" with "${value}"` },
});

export const setShared = ({ what, value }: TNamed, vstep: TFeatureStep, world: TWorld, emptyOnly = false) => {
	let { shared } = world;

	if (!emptyOnly || shared.get(what) === undefined) {
		shared.set(what, value);

		return OK;
	}

	return { ...OK, topics: { ...didNotOverwrite(what, shared.get(what), value) } };
};
