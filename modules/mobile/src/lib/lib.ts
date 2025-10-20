import { Browser } from "webdriverio";

interface AccessibilityElement {
	type: string;
	text?: string;
	contentDescription?: string;
	resourceId?: string;
	testID?: string;
	className?: string;
	displayed?: boolean;
	enabled?: boolean;
	bounds?: string;
}

export async function getAccessibilityTree(driver: Browser): Promise<AccessibilityElement[]> {
	const elements = await driver.$$('//*');
	const snapshot: AccessibilityElement[] = [];

	for (const element of elements) {
		try {
			const [type, className, text, contentDesc, resourceId, name, accessibilityId] = await Promise.all([
				element.getAttribute('type').catch(() => null),
				element.getAttribute('class').catch(() => null),
				element.getText().catch(() => null),
				element.getAttribute('content-desc').catch(() => null),
				element.getAttribute('resource-id').catch(() => null),
				element.getAttribute('name').catch(() => null),
				element.getAttribute('accessibility-id').catch(() => null),
			]);

			const testID = accessibilityId || name || undefined;
			const hasUsefulData = text || contentDesc || resourceId || testID;

			if (!hasUsefulData) {
				continue;
			}

			const [displayed, enabled, location, size] = await Promise.all([
				element.isDisplayed().catch(() => false),
				element.isEnabled().catch(() => true),
				element.getLocation().catch(() => null),
				element.getSize().catch(() => null),
			]);

			const elementData: AccessibilityElement = {
				type: type || className || 'unknown',
			};

			if (text) elementData.text = text;
			if (contentDesc) elementData.contentDescription = contentDesc;
			if (resourceId) elementData.resourceId = resourceId;
			if (testID) elementData.testID = testID;
			if (className) elementData.className = className;
			if (location && size) {
				elementData.bounds = `[${location.x},${location.y}][${location.x + size.width},${location.y + size.height}]`;
			}

			elementData.displayed = displayed;
			elementData.enabled = enabled;

			snapshot.push(elementData);
		} catch (error: unknown) {
			continue;
		}
	}

	return snapshot;
}
