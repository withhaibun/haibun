import { TArtifactMessageContext, TExecutorMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';

export const CLASS_DISAPPEARS = 'haibun-disappears';
export const CLASS_LOADER = 'haibun-loader';

export const logToElement = (
	el: HTMLElement,
	{ level, message, messageContext }: { level: string; message: string; messageContext?: string }
) => {
	if (!el || !el.appendChild) {
		throw new Error('Invalid element provided to logToElement:' + el);
	}

	const isContextEmpty = (messageContext: string | undefined) => {
		return !messageContext || messageContext === '{}';
	};

	// Check if the style element already exists and create it if not
	if (!document.querySelector('style#haibun-loader-style')) {
		const style = document.createElement('style');
		style.id = 'haibun-loader-style';
		style.textContent = `
		`;
		document.head.appendChild(style);
	}

	function createLoader(content: string): HTMLDivElement {
		const loader = document.createElement('div');
		loader.classList.add('haibun-loader');
		loader.textContent = content;
		return loader;
	}

	function createDetailsDiv(level: string, messageContext: string): HTMLDivElement {
		const detailsDiv = document.createElement('div');
		detailsDiv.classList.add('haibun-details-div');

		if (!isContextEmpty(messageContext)) {
			const summary = document.createElement('summary');
			const details = document.createElement('details');
			summary.textContent = level;
			const contextPre = document.createElement('pre');
			contextPre.textContent = messageContext;
			details.appendChild(summary);
			details.appendChild(contextPre);
			detailsDiv.appendChild(details);
		} else {
			const loader = createLoader('');
			detailsDiv.appendChild(loader);
		}
		return detailsDiv;
	}
	function createArtifactDiv(artifact: TArtifactMessageContext): HTMLDivElement {
		const artifactDiv = document.createElement('div');
		artifactDiv.classList.add('haibun-artifact-div');

		const summary = document.createElement('summary');
		summary.textContent = a.artifact.type;
		const details = document.createElement('details');
		details.appendChild(summary);
		if (a.artifact.type === 'html' && a.artifact.content) {
			const contentDiv = document.createElement('iframe');
			contentDiv.srcdoc = a.artifact.content;
			contentDiv.style.border = 'none';
			contentDiv.style.width = '100%';
			contentDiv.style.height = '80vh';
			details.appendChild(contentDiv);
		} else {
			const contextPre = document.createElement('pre');
			contextPre.textContent = JSON.stringify(artifact.artifact, null, 2);
			details.appendChild(contextPre);
		}
		const detailsWrapper = document.createElement('div');
		detailsWrapper.classList.add('haibun-artifact-content');
		detailsWrapper.appendChild(details);
		artifactDiv.appendChild(detailsWrapper);
		return artifactDiv;
	}

	function createMessagesDiv(message: string): HTMLDivElement {
		const messagesDiv = document.createElement('div');
		messagesDiv.classList.add('haibun-messages-div');

		const div = document.createElement('div');
		div.textContent = message;
		messagesDiv.appendChild(div);
		return messagesDiv;
	}

	const existingNoContextElements = el.querySelectorAll(`.haibun-disappears`);
	existingNoContextElements.forEach((element) => element.remove());

	const container = document.createElement('div');
	container.classList.add('haibun-log-container', `haibun-level-${level}`);
	const latest = `${Date.now()}`;
	container.dataset.time = latest;
	if (isContextEmpty(messageContext)) {
		container.classList.add('haibun-disappears');
	} else {
		try {
			const c: TExecutorMessageContext = JSON.parse(messageContext);
			if (c.topic.stage === 'Executor') {
				message = `${message} ${c.topic.result.in}`;
			}
		} catch (e) {
			console.error('Error parsing messageContext', messageContext, e);
		}
	}
	const detailsDiv = createDetailsDiv(level, messageContext);
	const messagesDiv = createMessagesDiv(message);

	container.appendChild(detailsDiv);
	container.appendChild(messagesDiv);

	const a = <TArtifactMessageContext>JSON.parse(messageContext);
	if (a.artifact) {
		const artifact = createArtifactDiv(a);
		messagesDiv.append(artifact);
	}

	el.appendChild(container);

	if (el.scrollHeight > el.clientHeight) {
		container.scrollIntoView({ block: 'end' });
	}
};
