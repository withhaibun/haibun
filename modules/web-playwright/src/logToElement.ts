import { TExecutorResult } from '@haibun/core/build/lib/defs.js';
import {
	TExecutorMessageContext,
	TLogHistoryWithArtifact,
	TLogHistoryWithExecutorTopic,
} from '@haibun/core/build/lib/interfaces/logger.js';

export const logToElement = (el, { level, message, messageContext }) => {
	if (!el || !el.appendChild) {
		throw Error('Invalid element provided to logToElement:', el);
	}

	const isContextEmpty = (messageContext: string | undefined) => {
		return !messageContext || messageContext === '{}';
	};

	// Check if the style element already exists and create it if not
	if (!document.querySelector('style#haibun-loader-style')) {
		const style = document.createElement('style');
		style.id = 'haibun-loader-style';
		style.textContent = `
      .haibun-loader {
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        animation: spin 0.8s linear infinite;
      }

      .haibun-log-container {
        display: flex;
        flex-direction: row;
        width: 100%;
        align-items: flex-start;
      }
      .haibun-details-div {
        width: 100px;
        overflow: visible;
      }
      .haibun-messages-div {
        flex-grow: 1;
        margin-left: 10px;
        white-space: pre-wrap;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
		document.head.appendChild(style);
	}

	function createLoader(): HTMLDivElement {
		const loader = document.createElement('div');
		loader.classList.add('haibun-loader');
		return loader;
	}

	function createDetailsDiv(level: string, messageContext: string): HTMLDivElement {
		const detailsDiv = document.createElement('div');
		detailsDiv.classList.add('haibun-details-div');

		if (!isContextEmpty(messageContext)) {
			const details = document.createElement('details');
			const summary = document.createElement('summary');
			summary.textContent = level;
			const contextPre = document.createElement('pre');
			contextPre.textContent = messageContext;
			details.appendChild(summary);
			details.appendChild(contextPre);
			detailsDiv.appendChild(details);
		} else {
			const loader = createLoader();
			loader.textContent = '';
			detailsDiv.classList.add('haibun-no-context');
			detailsDiv.appendChild(loader);
		}
		return detailsDiv;
	}

	function createMessagesDiv(message: string): HTMLDivElement {
		const messagesDiv = document.createElement('div');
		messagesDiv.classList.add('haibun-messages-div');

		const div = document.createElement('div');
		div.textContent = message;
		messagesDiv.appendChild(div);
		return messagesDiv;
	}

	const existingNoContextElements = el.querySelectorAll('.haibun-no-context');
	existingNoContextElements.forEach((element) => element.remove());

	const container = document.createElement('div');
	container.classList.add('haibun-log-container');
	if (isContextEmpty(messageContext)) {
		container.classList.add('haibun-no-context');
	} else {
	const c: TExecutorMessageContext = JSON.parse(messageContext);
	if (c.topic.stage === 'Executor') {
    message = `${message} ${c.topic.result.in}`;
	}
}
	const detailsDiv = createDetailsDiv(level, messageContext);
	const messagesDiv = createMessagesDiv(message);

	container.appendChild(detailsDiv);
	container.appendChild(messagesDiv);

	el.appendChild(container);
};
