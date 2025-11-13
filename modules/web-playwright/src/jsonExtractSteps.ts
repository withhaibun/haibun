import { actionNotOK } from '@haibun/core/lib/util/index.js';
import { OK, Origin, TFeatureStep } from '@haibun/core/lib/defs.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';
import WebPlaywright from './web-playwright.js';
import { TAnyFixme } from '@haibun/core/lib/fixme.js';

const getTargetFromResponse = (json: TAnyFixme, index: number): TAnyFixme => {
	return Array.isArray(json) ? json[index] : json;
};

const parseIndex = (indexStr: string): number => {
	// Handle ordinal patterns like "1st", "2nd", "3rd", "4th", "14th", etc.
	const ordinalMatch = indexStr.match(/^(\d+)(?:st|nd|rd|th)$/i);
	if (ordinalMatch) {
		return parseInt(ordinalMatch[1], 10) - 1; // Convert 1-based to 0-based
	}
	
	// Try parsing as a direct number (0-based index)
	const num = parseInt(indexStr, 10);
	if (!isNaN(num)) {
		return num;
	}
	
	return 0; // Default to first (index 0)
};

const valueToString = (value: TAnyFixme): string => {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (value === null || value === undefined) {
		return String(value);
	}
	return JSON.stringify(value);
};

export const jsonExtractSteps = (webPlaywright: WebPlaywright) => ({
	extractPropertyFromResponseJson: {
		gwta: `extract property {property} from {ordinal} item in JSON response into {variable}`,
		action: ({ property, ordinal = '1st', variable }: { property: string; ordinal?: string; variable: string }, featureStep: TFeatureStep) => {
			const lastResponse = webPlaywright.getLastResponse();
			
			if (!lastResponse?.json) {
				return actionNotOK(`No JSON response available. Make an HTTP request first.`);
			}
			
			const index = parseIndex(ordinal);
			const target = getTargetFromResponse(lastResponse.json, index);
			
			if (!target) {
				return actionNotOK(`Response is empty or invalid.`);
			}
			
			const value = target[property];
			const valueStr = valueToString(value);
			
			webPlaywright.getWorld().shared.set(
				{ term: variable, value: valueStr, domain: DOMAIN_STRING, origin: Origin.var },
				{ in: featureStep.in, seq: featureStep.seqPath, when: `jsonExtractSteps.extractPropertyFromResponseJson` }
			);
			
			webPlaywright.getWorld().logger.info(`Extracted ${property}='${valueStr}' from ${ordinal} item into variable '${variable}'`);
			
			return OK;
		},
	},
});
