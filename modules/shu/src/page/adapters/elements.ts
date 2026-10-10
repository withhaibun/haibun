/** The page's custom element registry, and the load of a component's script. */
import type { TElements } from "../ports.js";

/** Returns the elements `registry` defines. */
export function browserElements(registry: CustomElementRegistry): TElements {
	return {
		define: (tag, element) => {
			if (!registry.get(tag)) registry.define(tag, element);
		},
		isDefined: (tag) => registry.get(tag) !== undefined,
		load: async (tag, script) => {
			await import(/* @vite-ignore */ script);
			if (!registry.get(tag)) throw new Error(`${script} loaded, and it didn't define <${tag}>. The script defines its element with customElements.define("${tag}", …)`);
		},
	};
}
