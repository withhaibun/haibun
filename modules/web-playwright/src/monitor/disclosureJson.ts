import { TAnyFixme } from "@haibun/core/build/lib/fixme.js";

function isSimpleAggregate(value: TAnyFixme): boolean {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return true;
		return value.every(item => typeof item !== 'object' || item === null);
	} else {
		const keys = Object.keys(value);
		if (keys.length === 0) return true;
		return keys.every(key => typeof value[key] !== 'object' || value[key] === null);
	}
}

function getPrimitiveString(value: TAnyFixme): string {
	if (typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (value === null) return 'null';
	return String(value);
}

function getSimpleAggregateString(value: TAnyFixme): string {
	if (Array.isArray(value)) {
		return `[${value.map(item => getPrimitiveString(item)).join(', ')}]`;
	} else if (typeof value === 'object' && value !== null) {
		const parts = Object.entries(value).map(([k, v]) => `"${k}": ${getPrimitiveString(v)}`);
		return `{ ${parts.join(', ')} }`;
	}
	return String(value);
}

function createInlineDisplayForSimpleAggregate(aggregateValue: TAnyFixme): HTMLElement {
	const containerSpan = document.createElement('span');
	containerSpan.className = 'simple-aggregate-inline';

	if (Array.isArray(aggregateValue)) {
		containerSpan.appendChild(document.createTextNode('['));
		aggregateValue.forEach((item, index) => {
			containerSpan.appendChild(createPrimitiveNode(item));
			if (index < aggregateValue.length - 1) {
				containerSpan.appendChild(document.createTextNode(', '));
			}
		});
		containerSpan.appendChild(document.createTextNode(']'));
	} else if (typeof aggregateValue === 'object' && aggregateValue !== null) {
		containerSpan.appendChild(document.createTextNode('{ '));
		const keys = Object.keys(aggregateValue);
		keys.forEach((key, index) => {
			const keySpan = document.createElement('span');
			keySpan.className = 'key inline-key';
			keySpan.textContent = `"${key}": `;
			containerSpan.appendChild(keySpan);
			containerSpan.appendChild(createPrimitiveNode(aggregateValue[key]));
			if (index < keys.length - 1) {
				containerSpan.appendChild(document.createTextNode(', '));
			}
		});
		containerSpan.appendChild(document.createTextNode(' }'));
	}
	return containerSpan;
}

export function disclosureJson(jsonObj: TAnyFixme): HTMLElement | undefined {
	if (typeof jsonObj !== 'object' || jsonObj === null) {
		const primitiveContainer = document.createElement('div');
		primitiveContainer.className = 'json-root-primitive';
		primitiveContainer.appendChild(createPrimitiveNode(jsonObj));
		primitiveContainer.dataset.rawJson = JSON.stringify(jsonObj);
		return primitiveContainer;
	}

	if (isSimpleAggregate(jsonObj)) {
		const simpleRootContainer = document.createElement('div');
		simpleRootContainer.className = 'json-root-simple-aggregate';
		simpleRootContainer.appendChild(createInlineDisplayForSimpleAggregate(jsonObj));
		simpleRootContainer.dataset.rawJson = JSON.stringify(jsonObj);
		return simpleRootContainer;
	} else {
		const rootContainer = document.createElement('div');
		rootContainer.className = 'json-root-complex';
		rootContainer.dataset.rawJson = JSON.stringify(jsonObj);

		const isRootArray = Array.isArray(jsonObj);
		if (isRootArray) {
			(jsonObj as TAnyFixme[]).forEach((item, index) => {
				appendNode(index, item, true, rootContainer, 0, undefined);
			});
		} else {
			Object.keys(jsonObj).forEach(key => {
				appendNode(key, jsonObj[key], false, rootContainer, 0, undefined);
			});
		}
		return rootContainer;
	}
}

function appendNode(key: string | number, value: TAnyFixme, isArrayIndex: boolean, parentElement: HTMLElement, indentLevel: number = 0, parentKey?: string | number): void {
	const isPrimitiveVal = typeof value !== 'object' || value === null;

	const autoGrow = (element: HTMLTextAreaElement) => {
		let helper = document.getElementById('autogrow-helper') as HTMLDivElement | null;
		if (!helper) {
			helper = document.createElement('div');
			helper.id = 'autogrow-helper';
			helper.style.position = 'absolute';
			helper.style.left = '-9999px';
			helper.style.top = '0';
			helper.style.visibility = 'hidden';
			helper.style.pointerEvents = 'none';
			document.body.appendChild(helper);
		}

		const computedStyle = window.getComputedStyle(element);
		helper.style.font = computedStyle.font;
		helper.style.letterSpacing = computedStyle.letterSpacing;
		helper.style.paddingTop = computedStyle.paddingTop;
		helper.style.paddingRight = computedStyle.paddingRight;
		helper.style.paddingBottom = computedStyle.paddingBottom;
		helper.style.paddingLeft = computedStyle.paddingLeft;
		helper.style.borderTopWidth = computedStyle.borderTopWidth;
		helper.style.borderRightWidth = computedStyle.borderRightWidth;
		helper.style.borderBottomWidth = computedStyle.borderBottomWidth;
		helper.style.borderLeftWidth = computedStyle.borderLeftWidth;
		helper.style.borderStyle = computedStyle.borderStyle;
		helper.style.boxSizing = 'border-box';
		helper.style.lineHeight = computedStyle.lineHeight;

		helper.style.whiteSpace = 'nowrap';
		helper.style.width = 'auto';
		helper.textContent = element.value || ' ';
		let contentWidth = helper.scrollWidth;
		contentWidth += 2; // Add a small buffer to make it slightly wider

		element.style.width = contentWidth + 'px';

		const actualTextareaWidth = element.offsetWidth;

		helper.style.whiteSpace = 'pre-wrap';
		helper.style.width = actualTextareaWidth + 'px';
		helper.textContent = element.value || ' ';
		const newHeight = helper.scrollHeight;

		element.style.height = newHeight + 'px';
	};

	if (isPrimitiveVal) {
		const lineDiv = document.createElement('div');
		lineDiv.className = 'json-line primitive-kv';
		let marginLeftPx = 0;
		if (indentLevel === 1) {
			marginLeftPx = 20;
		} else if (indentLevel > 1) {
			marginLeftPx = 20 + (indentLevel - 1) * 15;
		}
		lineDiv.style.marginLeft = `${marginLeftPx}px`;

		const keySpan = document.createElement('span');
		keySpan.className = isArrayIndex ? 'key index' : 'key';
		keySpan.textContent = isArrayIndex ? `[${key}]: ` : `${key}: `;
		lineDiv.appendChild(keySpan);

		let useTextArea = false;
		if (isPrimitiveVal) {
			if (key === 'in' && typeof value === 'string') {
				useTextArea = true;
			} else if (key === 'named') {
				useTextArea = true;
			} else if (parentKey === 'named' || parentKey === 'namedWithVars') {
				useTextArea = true;
			}
		}

		if (useTextArea) {
			const textArea = document.createElement('textarea');
			textArea.classList.add('expanded-value-textarea');
			textArea.value = String(value);

			let pathForId = 'root';
			if (parentElement.parentElement && parentElement.parentElement.tagName === 'DETAILS') {
				pathForId = getPathToNode(parentElement.parentElement as HTMLElement);
			}
			const keyString = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
			textArea.id = `textarea-${pathForId}-${keyString}`;
			textArea.rows = 1;

			const setInitialWidth = (element: HTMLTextAreaElement) => {
				let helper = document.getElementById('autogrow-helper') as HTMLDivElement | null;
				if (!helper) {
					helper = document.createElement('div');
					helper.id = 'autogrow-helper';
					helper.style.position = 'absolute';
					helper.style.left = '-9999px';
					helper.style.top = '0';
					helper.style.visibility = 'hidden';
					helper.style.pointerEvents = 'none';
					document.body.appendChild(helper);
				}

				const computedStyle = window.getComputedStyle(element);
				helper.style.font = computedStyle.font;
				helper.style.letterSpacing = computedStyle.letterSpacing;
				helper.style.paddingTop = computedStyle.paddingTop;
				helper.style.paddingRight = computedStyle.paddingRight;
				helper.style.paddingBottom = computedStyle.paddingBottom;
				helper.style.paddingLeft = computedStyle.paddingLeft;
				helper.style.borderTopWidth = computedStyle.borderTopWidth;
				helper.style.borderRightWidth = computedStyle.borderRightWidth;
				helper.style.borderBottomWidth = computedStyle.borderBottomWidth;
				helper.style.borderLeftWidth = computedStyle.borderLeftWidth;
				helper.style.borderStyle = computedStyle.borderStyle;
				helper.style.boxSizing = 'border-box';
				helper.style.lineHeight = computedStyle.lineHeight;

				helper.style.whiteSpace = 'nowrap';
				helper.style.width = 'auto';
				helper.textContent = element.value || ' ';
				let contentWidth = helper.scrollWidth;
				contentWidth += 2;

				element.style.width = contentWidth + 'px';
			};

			const handleInputResize = (element: HTMLTextAreaElement) => {
				// Optional: Recalculate width on input if desired, or assume user will resize manually if initial width is not perfect.
				// For now, focus on height for input.
				element.style.height = 'auto';
				element.style.height = element.scrollHeight + 'px';
			};

			textArea.addEventListener('input', () => handleInputResize(textArea));

			lineDiv.appendChild(textArea);
			lineDiv.classList.add('line-with-textarea');
			parentElement.appendChild(lineDiv);

			requestAnimationFrame(() => {
				setInitialWidth(textArea);
			});
		} else {
			lineDiv.appendChild(createPrimitiveNode(value));
			parentElement.appendChild(lineDiv);
		}
	} else {
		const forceComplex = key === 'named' || key === 'namedWithVars';
		if (!forceComplex && isSimpleAggregate(value)) {
			const lineDiv = document.createElement('div');
			lineDiv.className = 'json-line simple-aggregate-kv';
			let marginLeftPx = 0;
			if (indentLevel === 1) {
				marginLeftPx = 20;
			} else if (indentLevel > 1) {
				marginLeftPx = 20 + (indentLevel - 1) * 15;
			}
			lineDiv.style.marginLeft = `${marginLeftPx}px`;

			const keySpan = document.createElement('span');
			keySpan.className = isArrayIndex ? 'key index' : 'key';
			keySpan.textContent = isArrayIndex ? `[${key}]: ` : `${key}: `;
			lineDiv.appendChild(keySpan);

			lineDiv.appendChild(createInlineDisplayForSimpleAggregate(value));
			parentElement.appendChild(lineDiv);
		} else {
			const details = document.createElement('details');
			details.className = (isArrayIndex ? 'json-array-item' : 'json-object-item') + ' expandable';
			let marginLeftPx = 0;
			if (indentLevel === 1) {
				marginLeftPx = 20;
			} else if (indentLevel > 1) {
				marginLeftPx = 20 + (indentLevel - 1) * 15;
			}
			details.style.marginLeft = `${marginLeftPx}px`;
			details.open = false;

			const summary = document.createElement('summary');

			const summaryContentSpan = document.createElement('span');

			const keyDisplayPart = document.createElement('span');
			keyDisplayPart.className = isArrayIndex ? 'key index' : 'key';
			keyDisplayPart.textContent = isArrayIndex ? `[${String(key)}]: ` : `${String(key)}: `;
			summaryContentSpan.appendChild(keyDisplayPart);

			const childrenSummarySpan = document.createElement('span');
			childrenSummarySpan.className = 'children-summary-inline';

			const summaryChildrenParts = [];
			if (Array.isArray(value)) {
				(value as TAnyFixme[]).forEach((childValue, childIndex) => {
					const childKeyString = String(childIndex);
					const isChildValuePrimitive = typeof childValue !== 'object' || childValue === null;
					if (isChildValuePrimitive) {
						summaryChildrenParts.push(`{${childKeyString}: ${getPrimitiveString(childValue)}}`);
					} else if (isSimpleAggregate(childValue)) {
						summaryChildrenParts.push(`{${childKeyString}: ${getSimpleAggregateString(childValue)}}`);
					} else {
						summaryChildrenParts.push(`<span class="complex-child-marker">+${childKeyString}</span>`);
					}
				});
			} else {
				Object.entries(value).forEach(([childKey, childValue]) => {
					const isChildValuePrimitive = typeof childValue !== 'object' || childValue === null;
					if (isChildValuePrimitive) {
						summaryChildrenParts.push(`{${childKey}: ${getPrimitiveString(childValue)}}`);
					} else if (isSimpleAggregate(childValue)) {
						summaryChildrenParts.push(`{${childKey}: ${getSimpleAggregateString(childValue)}}`);
					} else {
						summaryChildrenParts.push(`<span class="complex-child-marker">+${childKey}</span>`);
					}
				});
			}

			childrenSummarySpan.innerHTML = summaryChildrenParts.join(', ');
			summaryContentSpan.appendChild(childrenSummarySpan);

			summary.appendChild(summaryContentSpan);
			details.appendChild(summary);

			const detailsContentDiv = document.createElement('div');
			detailsContentDiv.className = 'details-content';

			if (Array.isArray(value)) {
				(value as TAnyFixme[]).forEach((item, childIndex) => {
					appendNode(childIndex, item, true, detailsContentDiv, indentLevel + 1, key);
				});
			} else {
				Object.entries(value).forEach(([childKey, childValue]) => {
					appendNode(childKey, childValue, false, detailsContentDiv, indentLevel + 1, key);
				});
			}
			details.appendChild(detailsContentDiv);

			details.addEventListener('toggle', () => {
				if (details.open) {
					childrenSummarySpan.classList.add('hidden');
				} else {
					childrenSummarySpan.classList.remove('hidden');
				}
			});
			if (!details.open) {
				childrenSummarySpan.classList.remove('hidden');
			} else {
				childrenSummarySpan.classList.add('hidden');
			}

			parentElement.appendChild(details);
		}
	}
}

function getPathToNode(element: HTMLElement): string {
	const parts: string[] = [];
	while (element && element.parentElement && !element.classList.contains('json-root-complex')) {
		const keySpan = element.querySelector(':scope > summary > span > .key');
		let key = keySpan?.textContent?.replace(/: $/, '') || 'item';
		if (element.classList.contains('json-array-item')) {
			key = element.querySelector(':scope > summary > span > .key.index')?.textContent?.replace(/[\[\]:]/g, '') || 'index';
		}
		parts.unshift(key);
		element = element.parentElement.closest('details, .json-root-complex');
	}
	return parts.join('-');
}

function createPrimitiveNode(value: TAnyFixme): HTMLSpanElement {
	const span = document.createElement('span');
	span.classList.add('value');

	let displayValue: string;
	let typeClass: string = typeof value;

	if (value === null) {
		typeClass = 'null';
		displayValue = 'null';
	} else if (typeClass === 'string') {
		displayValue = JSON.stringify(value);
	} else if (typeClass === 'undefined') {
		displayValue = 'undefined';
	} else {
		displayValue = String(value);
	}

	span.classList.add(`value-${typeClass}`);
	span.textContent = displayValue;
	return span;
}
