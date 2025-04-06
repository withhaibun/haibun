import { TAnyFixme } from "@haibun/core/build/lib/defs.js";

export function disclosureJson(jsonObj: TAnyFixme) {
	const rootNode = buildRecursiveDetails(jsonObj, 0);
	if (rootNode) {
		if (typeof jsonObj === 'object' && jsonObj !== null) {
			const rootDetails = document.createElement('details');
			// Root should be closed by default
			rootDetails.open = false;

			// Add a class to ensure CSS styling is applied
			rootDetails.className = 'json-root-details';

			const summary = document.createElement('summary');
			// Ensure the summary displays as a list item for proper disclosure triangle
			summary.style.display = 'list-item';
			summary.style.cursor = 'pointer'; // Add pointer cursor to indicate it's clickable

			const count = Array.isArray(jsonObj) ? jsonObj.length : Object.keys(jsonObj).length;

			// Use "JSON result with X keys" format for root
			const countText = Array.isArray(jsonObj)
				? `${count} ${count === 1 ? 'item' : 'items'}`
				: `${count} ${count === 1 ? 'key' : 'keys'}`;

			summary.innerHTML = `<span class="key root-key">JSON result with ${countText}</span>`;
			rootDetails.appendChild(summary);

			rootDetails.appendChild(rootNode);
			return rootDetails;
		}
	}
}

function appendNode(key: string | number, value: TAnyFixme, isArrayIndex: boolean, parentElement: HTMLElement, indentLevel: number = 0): void {
	const valueNode = buildRecursiveDetails(value, indentLevel);

	// Fix 2 & 3: Type guard for Element properties
	if (valueNode instanceof Element && valueNode.tagName === 'DIV' && valueNode.classList.contains('details-content')) {
		const details = document.createElement('details');
		details.className = isArrayIndex ? 'json-array-item' : 'json-object-item';

		// Apply indentation to the details element
		details.style.marginLeft = `${indentLevel * 20}px`;

		const summary = document.createElement('summary');
		summary.style.display = 'list-item'; // Ensure the summary displays as a list item for proper disclosure triangle
		summary.style.cursor = 'pointer'; // Add pointer cursor to indicate it's clickable

		const keyClass = isArrayIndex ? 'key index' : 'key';
		const keyText = isArrayIndex ? `[${key}]:` : `${key}:`;
		const valueCount = Array.isArray(value) ? value.length : Object.keys(value).length;

		// More human-friendly type indicators
		const typeIndicator = Array.isArray(value)
			? `${valueCount} ${valueCount === 1 ? 'Item' : 'Items'}`
			: `${valueCount} ${valueCount === 1 ? 'Key' : 'Keys'}`;

		summary.innerHTML = `<span class="${keyClass}">${keyText}</span> <span class="type-indicator">${typeIndicator}</span>`;

		details.appendChild(summary);
		details.appendChild(valueNode);
		parentElement.appendChild(details);

	} else {
		const lineDiv = document.createElement('div');
		lineDiv.className = 'json-line';

		// Apply indentation to primitive values
		lineDiv.style.marginLeft = `${indentLevel * 20}px`;

		const keyClass = isArrayIndex ? 'key index' : 'key';
		const keyText = isArrayIndex ? `[${key}]:` : `${key}:`;
		lineDiv.innerHTML = `<span class="${keyClass}">${keyText}</span> `;
		lineDiv.appendChild(valueNode);
		parentElement.appendChild(lineDiv);
	}
}

function buildRecursiveDetails(data: TAnyFixme, indentLevel: number = 0): HTMLElement | Text {
	const type = typeof data;

	if (data === null || ['string', 'number', 'boolean', 'undefined'].includes(type)) {
		return createPrimitiveNode(data);
	}

	if (type === 'object') {
		const isArray = Array.isArray(data);
		const containerDiv = document.createElement('div');
		containerDiv.className = 'details-content';

		let isEmpty = true;

		if (isArray) {
			(data as TAnyFixme[]).forEach((item, index) => {
				isEmpty = false;
				appendNode(index, item, true, containerDiv, indentLevel + 1);
			});
		} else {
			Object.keys(data).forEach(key => {
				isEmpty = false;
				appendNode(key, data[key], false, containerDiv, indentLevel + 1);
			});
		}

		if (isEmpty) {
			const emptyIndicator = createEmptyIndicator(isArray ? 'Array' : 'Object');
			// Apply indentation to empty indicators
			emptyIndicator.style.marginLeft = `${indentLevel * 20}px`;
			containerDiv.appendChild(emptyIndicator);
		}

		return containerDiv;
	}

	return document.createTextNode('(Unknown Type)');
}

function createPrimitiveNode(value: TAnyFixme): HTMLSpanElement {
	const span = document.createElement('span');
	span.classList.add('value');
	let displayValue: string = String(value);
	let typeClass: string = typeof value; // Fix 4: Ensure typeClass is string

	if (value === null) {
		typeClass = 'null';
		displayValue = 'null';
	} else if (typeClass === 'string') {
		displayValue = `"${value}"`;
	} else if (typeClass === 'undefined') {
		displayValue = 'undefined';
	}

	span.classList.add(`value-${typeClass}`);
	span.textContent = displayValue;
	return span;
}

function createEmptyIndicator(type: string): HTMLElement {
	const indicator = document.createElement('span');
	indicator.className = 'empty-indicator';
	indicator.textContent = type === 'Array' ? '[] (Empty Array)' : '{} (Empty Object)';
	return indicator;
}
