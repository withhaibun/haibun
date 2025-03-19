import { TExecutorMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';

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
      .haibun-loader {
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        animation: spin 9.8s linear infinite;
      }

      .haibun-log-container {
        display: flex;
        flex-direction: row;
        width: 100%;
        align-items: flex-start;
      }
      .haibun-details-div {
        min-width: 100px;
      }
      .haibun-messages-div {
        flex-grow: 1;
        margin-left: 10px;
        white-space: pre-wrap;
      }
      .haibun-messages-div > div {
        display: inline;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
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
			const details = document.createElement('details');
			const summary = document.createElement('summary');
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

	el.appendChild(container);

	if (el.scrollHeight > el.clientHeight) {
		container.scrollIntoView({ block: 'end' });
	}
};
