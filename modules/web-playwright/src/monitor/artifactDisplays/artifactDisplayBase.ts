import { TArtifact } from '@haibun/core/lib/interfaces/logger.js';

export abstract class LogComponent<T extends HTMLElement = HTMLElement> {
	readonly element: T;

	constructor(tagName: keyof HTMLElementTagNameMap, className?: string | string[]) {
		this.element = document.createElement(tagName) as T;
		if (className) {
			const classes = Array.isArray(className) ? className : [className];
			this.element.classList.add(...classes);
		}
	}

	append(child: LogComponent | HTMLElement): void {
		this.element.appendChild(child instanceof LogComponent ? child.element : child);
	}

	addClass(className: string): void {
		this.element.classList.add(className);
	}

	setData(key: string, value: string): void {
		this.element.dataset[key] = value;
	}

	setHtml(html: string): void {
		this.element.innerHTML = html;
	}

	setText(text: string): void {
		this.element.textContent = text;
	}
}

export abstract class ArtifactDisplay {
	readonly label: string;
	abstract readonly placementTarget: 'details' | 'haibun-focus' | 'body' | 'none';

	constructor(protected artifact: TArtifact) {
		this.label = this.deriveLabel();
	}

	deriveLabel(): string {
		return this.artifact.artifactType;
	}

	public abstract render(container: HTMLElement): Promise<void> | void;

	public get artifactType(): string {
		return this.artifact.artifactType;
	}
}
