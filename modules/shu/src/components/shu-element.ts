import { z } from "zod";

/**
 * Abstract base class for Shu web components.
 * Each subclass declares a Zod schema that serves as both the component's
 * state contract and a Haibun domain definition.
 */
export abstract class ShuElement<T extends z.ZodType> extends HTMLElement {
	protected state: z.infer<T>;
	private _schema: T;

	constructor(schema: T, defaults: z.infer<T>) {
		super();
		this._schema = schema;
		this.state = schema.parse(defaults);
		this.attachShadow({ mode: "open" });
	}

	get schema(): T {
		return this._schema;
	}

	protected setState(partial: Partial<z.infer<T>>): void {
		const next = this._schema.parse(Object.assign({}, this.state, partial));
		this.state = next;
		this.render();
		this.dispatchEvent(
			new CustomEvent("state-change", {
				detail: this.state,
				bubbles: true,
				composed: true,
			}),
		);
	}

	protected validate(data: unknown): z.infer<T> {
		return this._schema.parse(data);
	}

	protected safeValidate(data: unknown): {
		success: boolean;
		data?: z.infer<T>;
		error?: z.ZodError;
	} {
		const result = this._schema.safeParse(data);
		if (result.success) {
			return { success: true, data: result.data };
		}
		return { success: false, error: result.error };
	}

	connectedCallback(): void {
		this.render();
	}

	protected abstract render(): void;

	protected css(styles: string): string {
		return `<style>${styles}</style>`;
	}
}
