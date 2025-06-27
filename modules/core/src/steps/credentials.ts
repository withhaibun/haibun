import { OK, TNamed } from '../lib/defs.js';
import { AStepper } from '../lib/astepper.js';
import { randomString } from '../lib/util/index.js';

export const cred = (key: string) => `__cred_${key}`;

class Credentials extends AStepper {
	generateRandomUsername(ref: string) {
		this.getWorld().shared.set(cred(ref), randomString());
		return this.getWorld().shared.get(cred(ref));
	}

	generateRandomPassword(ref: string) {
		this.getWorld().shared.set(
			cred(ref),
			[
				'testpass',
				Math.floor(Math.random() * 1e8)
					.toString(36)
					.toUpperCase(),
			].join('_')
		);
		return this.getWorld().shared.get(cred(ref));
	}
	getRandom(name: string) {
		return this.getWorld().shared.get(cred(name));
	}

	steps = {
		hasRandomUsername: {
			gwta: `have a valid random username <{name}>`,
			action: async ({ name }: TNamed) => {
				this.generateRandomUsername(name);
				return Promise.resolve(OK);
			},
		},

		ensureRandomUsername: {
			gwta: `ensure valid random username <{name}>`,
			action: async ({ name }: TNamed) => {
				if (this.getWorld().shared.get(cred(name))) {
					return OK;
				}
				this.generateRandomUsername(name);
				return Promise.resolve(OK);
			},
		},

		hasRandomPassword: {
			gwta: `have a valid random password <{name}>`,
			action: async ({ name }: TNamed) => {
				this.generateRandomPassword(name);
				return Promise.resolve(OK);
			},
		},

		ensureRandomPassword: {
			gwta: `ensure valid random password <{name}>`,
			action: async ({ name }: TNamed) => {
				if (this.getWorld().shared.get(cred(name))) {
					return OK;
				}
				this.generateRandomPassword(name);
				return Promise.resolve(OK);
			},
		},
	};
};
export default Credentials;
