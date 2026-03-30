type RouteHandler = (params: Record<string, string>) => void;

interface Route {
	pattern: RegExp;
	paramNames: string[];
	handler: RouteHandler;
}

/**
 * Simple hash-based client-side router for the shu SPA.
 */
export class Router {
	private routes: Route[] = [];
	private notFoundHandler?: () => void;

	on(path: string, handler: RouteHandler): this {
		const paramNames: string[] = [];
		const pattern = path.replace(/:([^/]+)/g, (_match, name) => {
			paramNames.push(name);
			return "([^/]+)";
		});
		this.routes.push({
			pattern: new RegExp(`^${pattern}$`),
			paramNames,
			handler,
		});
		return this;
	}

	otherwise(handler: () => void): this {
		this.notFoundHandler = handler;
		return this;
	}

	start(): void {
		window.addEventListener("hashchange", () => this.resolve());
		this.resolve();
	}

	navigate(path: string): void {
		window.location.hash = path;
	}

	private resolve(): void {
		const hash = window.location.hash.slice(1) || "/";
		for (const route of this.routes) {
			const match = hash.match(route.pattern);
			if (match) {
				const params: Record<string, string> = {};
				route.paramNames.forEach((name, i) => {
					params[name] = match[i + 1];
				});
				route.handler(params);
				return;
			}
		}
		this.notFoundHandler?.();
	}
}
