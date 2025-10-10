import { Browser } from "webdriverio";

export async function getAccessibilityTree(driver: Browser) {
	const elements = await driver.$$('//*');

	const snapshot: Array<{
		type: string;
		text?: string;
		contentDescription?: string;
		resourceId?: string;
		testID?: string;
		accessibilityLabel?: string;
		className?: string;
		displayed?: boolean;
		enabled?: boolean;
		bounds?: string;
	}> = [];

	// Extract useful attributes from each element
	for (const element of elements) {
		try {
			const elementData: (typeof snapshot)[0] = {
				type: await element.getAttribute('type') || await element.getAttribute('class') || 'unknown',
			};

			// Get text content
			const text = await element.getText().catch(() => null);
			if (text) {
				elementData.text = text;
			}

			// Get accessibility identifiers
			const contentDesc = await element.getAttribute('content-desc').catch(() => null);
			if (contentDesc) {
				elementData.contentDescription = contentDesc;
				elementData.accessibilityLabel = contentDesc;
			}

			const resourceId = await element.getAttribute('resource-id').catch(() => null);
			if (resourceId) {
				elementData.resourceId = resourceId;
			}

			// Get name (iOS accessibility identifier / Android content-desc)
			const name = await element.getAttribute('name').catch(() => null);
			if (name && !elementData.contentDescription) {
				elementData.accessibilityLabel = name;
				elementData.testID = name;
			}

			// Get accessibility-id (testID in React Native)
			const accessibilityId = await element.getAttribute('accessibility-id').catch(() => null);
			if (accessibilityId) {
				elementData.testID = accessibilityId;
			}

			// Get class name
			const className = await element.getAttribute('class').catch(() => null);
			if (className) {
				elementData.className = className;
			}

			// Get display state
			const displayed = await element.isDisplayed().catch(() => false);
			elementData.displayed = displayed;

			const enabled = await element.isEnabled().catch(() => true);
			elementData.enabled = enabled;

			// Get bounds (position and size)
			const rect = await element.getLocation().catch(() => null);
			const size = await element.getSize().catch(() => null);
			if (rect && size) {
				elementData.bounds = `[${rect.x},${rect.y}][${rect.x + size.width},${rect.y + size.height}]`;
			}

			// Only include elements with useful identifiers or text
			if (elementData.text || elementData.contentDescription || elementData.resourceId ||
				elementData.testID || elementData.accessibilityLabel) {
				snapshot.push(elementData);
			}
		} catch (error: unknown) {
			console.warn('cannot access', error);
			continue;
		}
	}
	return snapshot;
}
