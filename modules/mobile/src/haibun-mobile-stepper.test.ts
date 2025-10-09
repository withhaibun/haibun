import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '@haibun/core/lib/test/lib.js';
import HaibunMobileStepper from './haibun-mobile-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import Haibun from '@haibun/core/steps/haibun.js';
import StorageMem from '@haibun/storage-mem';

const steppers = [VariablesStepper, Haibun, HaibunMobileStepper, StorageMem];

const testOptions = {
	options: { DEST: 'default' },
	moduleOptions: {
		HAIBUN_O_HAIBUNMOBILESTEPPER_STORAGE: 'StorageMem',
	},
};

describe('mobile domains', () => {
	it('sets element with mobile-testid domain', async () => {
		const feature = {
			path: '/features/mobile-testid.feature',
			content: 'set Login Button as mobile-testid to loginButton\nvariable "Login Button" is "loginButton"'
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(true);
	});

	it('sets element with mobile-xpath domain', async () => {
		const feature = {
			path: '/features/mobile-xpath.feature',
			content: `set Submit Button as mobile-xpath to //XCUIElementTypeButton[@name="Submit"]\nvariable "Submit Button" is "//XCUIElementTypeButton[@name="Submit"]"`
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(true);
	});

	it('sets multi-word element name with mobile-testid domain', async () => {
		const feature = {
			path: '/features/multi-word.feature',
			content: 'set User Name Input as mobile-testid to usernameField\nvariable "User Name Input" is "usernameField"'
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(true);
	});

	it('defaults to mobile-testid when using string domain', async () => {
		const feature = {
			path: '/features/string-domain.feature',
			content: 'set Button as string to testButton\nvariable "Button" is "testButton"'
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(true);
	});

	it('fails on unknown domain in set', async () => {
		const feature = {
			path: '/features/unknown-domain.feature',
			content: 'set Element as unknown-domain to someValue'
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(false);
	});

	it('stores mobile-testid selector with correct coercion', async () => {
		const feature = {
			path: '/features/testid-coercion.feature',
			content: 'set Login as mobile-testid to loginBtn'
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(true);

		const stored = res.world.shared.all()['Login'];
		expect(stored).toBeDefined();
		expect(stored.domain).toBe('mobile-testid');
		expect(stored.value).toBe('loginBtn');
	});

	it('stores mobile-xpath selector without modification', async () => {
		const feature = {
			path: '/features/xpath-coercion.feature',
			content: 'set Cancel as mobile-xpath to //android.widget.Button[@text="Cancel"]'
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(true);

		const stored = res.world.shared.all()['Cancel'];
		expect(stored).toBeDefined();
		expect(stored.domain).toBe('mobile-xpath');
		expect(stored.value).toBe('//android.widget.Button[@text="Cancel"]');
	});

	it('handles special characters in testID values', async () => {
		const feature = {
			path: '/features/special-chars.feature',
			content: 'set Complex Element as mobile-testid to button-login_2023\nvariable "Complex Element" is "button-login_2023"'
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(true);
	});

	it('handles xpath with quotes and brackets', async () => {
		const feature = {
			path: '/features/complex-xpath.feature',
			content: `set iOS Button as mobile-xpath to //XCUIElementTypeButton[@name="Log In" and @visible="true"]\nvariable "iOS Button" is "//XCUIElementTypeButton[@name="Log In" and @visible="true"]"`
		};
		const res = await testWithDefaults([feature], steppers, testOptions);
		expect(res.ok).toBe(true);
	});
});
