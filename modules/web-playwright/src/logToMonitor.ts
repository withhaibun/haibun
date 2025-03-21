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
	function createArtifactDiv(message: string, a: TArtifactMessageContext): HTMLDivElement {
		const artifactDiv = document.createElement('div');
		artifactDiv.classList.add('haibun-messages-div');

		const summary = document.createElement('summary');
		summary.textContent = message;
		const details = document.createElement('details');
		details.appendChild(summary);
		if (a.artifact.type === 'html' && a.artifact.content) {
			const contentDiv = document.createElement('iframe');
			contentDiv.srcdoc = a.artifact.content;
			contentDiv.style.border = 'none';
			contentDiv.style.width = '100%';
			contentDiv.style.height = '80vh';
			details.appendChild(contentDiv);
		} else if (a.artifact.type === 'image') {
			const contextPicture = document.createElement('img');
			contextPicture.alt = `Screen capture from message`;
			contextPicture.src = a.artifact.path;
			details.appendChild(contextPicture);
		} else if (a.artifact.type === 'video') {
			(window as any).haibun = { video: a.artifact.path };
			const contextVideo = document.createElement('video');
			contextVideo.controls = true;
			contextVideo.src = a.artifact.path;
			const haibunVideo = document.querySelector('#haibun-video');
			if (haibunVideo) {
				// console.log('set video');
				// haibunVideo.replaceChildren(contextVideo);
			} else {
				console.log('cannot find haibun-video');
			}
			details.appendChild(contextVideo);
		} else {
			if (a.artifact.type === 'json/playwright/trace') {
				// summary.textContent = `🔄`;
			}

			const contextPre = document.createElement('pre');
			contextPre.classList.add('haibun-message-details-json');
			contextPre.textContent = JSON.stringify(a.artifact, null, 2);
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

		messagesDiv.textContent = message;
		return messagesDiv;
	}

	const existingNoContextElements = el.querySelectorAll(`.haibun-disappears`);
	existingNoContextElements.forEach((element) => (element.classList.value = 'disappeared'));

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

	container.appendChild(detailsDiv);

	const a = <TArtifactMessageContext>JSON.parse(messageContext);
	if (a.artifact) {
		const artifact = createArtifactDiv(message, a);
		container.appendChild(artifact);
	} else {
		const messagesDiv = createMessagesDiv(message);
		container.appendChild(messagesDiv);
	}

	el.appendChild(container);

	if (el.scrollHeight > el.clientHeight) {
		container.scrollIntoView({ block: 'end' });
	}
};
