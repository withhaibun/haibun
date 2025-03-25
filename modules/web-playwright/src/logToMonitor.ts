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

	function createDetailsDiv(level: string, latest: number, messageContext: string): HTMLDivElement {
		const detailsDiv = document.createElement('div');
		detailsDiv.classList.add('haibun-details-div');

		if (!isContextEmpty(messageContext)) {
			const summary = document.createElement('summary');
			const details = document.createElement('details');
			summary.innerHTML = `${level}<div class="time-small">${('' + latest / 1000).replace('.', ':')}</div>`;
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

		const details = document.createElement('details');

		let detailsLabel: string = a.artifact.type;
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
			const contextVideo = document.createElement('video');
			contextVideo.controls = true;
			contextVideo.src = a.artifact.path;
			contextVideo.style.width = '320px';

			const haibunVideo: HTMLElement = document.querySelector('#haibun-video');
			if (haibunVideo) {
				haibunVideo.replaceChildren(contextVideo);
				haibunVideo.style.display = 'flex';
			} else {
				console.info('cannot find #haibun-video');
				details.appendChild(contextVideo);
			}
		} else if (a.artifact.type === 'video/start') {
			const startSpan = document.createElement('span');
			startSpan.id = 'haibun-video-start';
			startSpan.dataset.start = a.artifact.content;
			document.body.appendChild(startSpan);
		} else {
			if (a.artifact.type === 'json/playwright/trace') {
				detailsLabel = `⇄`;
			}

			const contextPre = document.createElement('pre');
			contextPre.classList.add('haibun-message-details-json');
			contextPre.textContent = JSON.stringify(a.artifact, null, 2);
			details.appendChild(contextPre);
		}
		const summary = document.createElement('summary');
		const labelSpan = document.createElement('span');
		labelSpan.className = 'details-type';
		labelSpan.textContent = detailsLabel;
		summary.textContent = message;
		summary.appendChild(labelSpan);

		details.appendChild(summary);
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
	function getStartTime() {
		let startSpan = document.getElementById('haibun-monitor-start')
		if (!startSpan) {
			startSpan = document.createElement('span');
			startSpan.id = 'haibun-monitor-start';
			startSpan.dataset.startTime = `${Date.now()}`;
			document.body.appendChild(startSpan);
		}
		const startTime = parseInt(startSpan.dataset.startTime, 10);
		return startTime;
	}

	const existingNoContextElements = el.querySelectorAll(`.haibun-disappears`);
	existingNoContextElements.forEach((element) => (element.classList.value = 'disappeared'));

	const container = document.createElement('div');

	const startTime = getStartTime();
	container.classList.add('haibun-log-container', `haibun-level-${level}`);
	const latest = Date.now() - startTime;
	container.dataset.time = `${latest}`;

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
	const detailsDiv = createDetailsDiv(level, latest, messageContext);

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
