import { OK } from '../lib/defs.js';
import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { randomString } from '../lib/util/index.js';

export const cred = (key: string) => `__cred_${key}`;

class Credentials extends AStepper {
	generateRandomUsername(ref: string) {
		this.getWorld().shared.set({ label: cred(ref), value: randomString(), domain: 'string', origin: 'literal' });
		return this.getWorld().shared.get(cred(ref));
	}

	generateRandomPassword(ref: string) {
		this.getWorld().shared.set({
			label: cred(ref),
			value: ['testpass', Math.floor(Math.random() * 1e8).toString(36).toUpperCase(),].join('_'),
			domain: 'string',
			origin: 'literal',
		});
		return this.getWorld().shared.get(cred(ref));
	}
	getRandom(name: string) {
		return this.getWorld().shared.get(cred(name));
	}

	steps: TStepperSteps = {
		hasRandomUsername: {
			gwta: 'have a valid random username <{name}>',
			action: ({ name }) => {
				this.generateRandomUsername(name as string);
				return Promise.resolve(OK);
			},
		},
		ensureRandomUsername: {
			gwta: 'ensure valid random username <{name}>',
			action: ({ name }) => {
				if (this.getWorld().shared.get(cred(name as string))) {
					return Promise.resolve(OK);
				}
				this.generateRandomUsername(name as string);
				return Promise.resolve(OK);
			},
		},
		hasRandomPassword: {
			gwta: 'have a valid random password <{name}>',
			action: ({ name }) => {
				this.generateRandomPassword(name as string);
				return Promise.resolve(OK);
			},
		},
		ensureRandomPassword: {
			gwta: 'ensure valid random password <{name}>',
			action: ({ name }) => {
				if (this.getWorld().shared.get(cred(name as string))) {
					return Promise.resolve(OK);
				}
				this.generateRandomPassword(name as string);
				return Promise.resolve(OK);
			},
		},
	};
}
export default Credentials;
