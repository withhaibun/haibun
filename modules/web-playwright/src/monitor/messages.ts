import { TArtifact, TMessageContext, TExecutorMessageContext, TArtifactMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { TPlaywrightTraceEvent } from '../PlaywrightEvents.js';
import { sequenceDiagramGenerator } from './monitor.js';

export function logMessageDetails(level: string, timestamp: number) {
	const messageDetailsDiv = document.createElement('div');
	messageDetailsDiv.classList.add('haibun-details-div');
	const summary = document.createElement('summary');
	const startTime = parseInt(document.body.dataset.startTime || `${Date.now()}`, 10);
	const relativeTime = timestamp - startTime;
	summary.innerHTML = `${level}<div class="time-small">${(relativeTime / 1000).toFixed(3).replace('.', ':')}s</div>`;
	return summary;
}

export function logMessageContent(message: string, messageContext: TMessageContext) {
	let summaryMessage = message;
	const messageContentDiv = document.createElement('div');
	messageContentDiv.classList.add('haibun-messages-div');

	if (messageContext) {
		if ((<TExecutorMessageContext>messageContext).topic?.stage === 'Executor' && (messageContext as TExecutorMessageContext).topic.result?.in) {
			summaryMessage = `${message} ${(messageContext as TExecutorMessageContext).topic.result.in}`;
		}

		if ((messageContext as TArtifactMessageContext).artifact) {
			const artifact = (messageContext as TArtifactMessageContext).artifact;
			createArtifactDiv(artifact, summaryMessage);

			if (artifact.type === 'json/playwright/trace' && artifact.content) {
				sequenceDiagramGenerator.processEvent(<TPlaywrightTraceEvent>artifact);
			}
		} else {
			// logContainer.classList.add('haibun-disappears');
		}

		return messageContentDiv;
	}
}

function createArtifactDiv(artifact: TArtifact, summaryMessage: string) {
	const artifactDiv = document.createElement('div');
	artifactDiv.classList.add('haibun-messages-div');

	const details = document.createElement('details');

	let detailsLabel: string = artifact.type;
	if (artifact.type === 'html' && artifact.content) {
		const contentDiv = document.createElement('iframe');
		contentDiv.srcdoc = artifact.content;
		contentDiv.style.border = 'none';
		contentDiv.style.width = '100%';
		contentDiv.style.height = '80vh';
		details.appendChild(contentDiv);
	} else if (artifact.type === 'image') {
		const contextPicture = document.createElement('img');
		contextPicture.alt = `Screen capture from message`;
		contextPicture.src = artifact.path;
		details.appendChild(contextPicture);
	} else if (artifact.type === 'video') {
		const contextVideo = document.createElement('video');
		contextVideo.controls = true;
		contextVideo.src = artifact.path;
		contextVideo.style.width = '320px';

		const haibunVideo: HTMLElement = document.querySelector('#haibun-video');
		if (haibunVideo) {
			haibunVideo.replaceChildren(contextVideo);
			haibunVideo.style.display = 'flex';
		} else {
			console.info('cannot find #haibun-video');
			details.appendChild(contextVideo);
		}
	} else if (artifact.type === 'video/start') {
		const startSpan = document.createElement('span');
		startSpan.id = 'haibun-video-start';
		startSpan.dataset.start = artifact.content;
		document.body.appendChild(startSpan);
	} else {
		if (artifact.type === 'json/playwright/trace') {
			detailsLabel = `⇄`;
		}

		const contextPre = document.createElement('pre');
		contextPre.classList.add('haibun-message-details-json');
		contextPre.textContent = JSON.stringify(artifact, null, 2);
		details.appendChild(contextPre);
	}
	const summary = document.createElement('summary');
	const labelSpan = document.createElement('span');
	labelSpan.className = 'details-type';
	labelSpan.textContent = detailsLabel;
	summary.textContent = summaryMessage;
	summary.appendChild(labelSpan);

	details.appendChild(summary);
	const detailsWrapper = document.createElement('div');
	detailsWrapper.classList.add('haibun-artifact-content');
	detailsWrapper.appendChild(details);
	artifactDiv.appendChild(detailsWrapper);
	return { artifactDiv, detailsLabel };
}
