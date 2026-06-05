// @vitest-environment jsdom
/**
 * Bedrock proof: lit-html's diff preserves a focused input across re-renders
 * with a changed sibling. Locks the claim the production migration is built on
 * — that switching the component render bodies from innerHTML blasts to
 * lit-html eliminates the focus-loss bug structurally, without per-component
 * preserve/restore scaffolding.
 *
 * If this ever fails, every component that depends on the property has lost
 * its safety net — fail loud.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { html, render } from "lit-html";

describe("lit-html focus preservation", () => {
	let host: HTMLElement;
	beforeEach(() => {
		document.body.innerHTML = "";
		host = document.createElement("div");
		document.body.appendChild(host);
	});

	const renderWithStatus = (status: string, value: string) => {
		render(
			html`
				<div class="status">${status}</div>
				<input id="search" type="text" .value=${value} />
			`,
			host,
		);
	};

	it("focused input keeps focus and cursor when a sibling field re-renders", () => {
		renderWithStatus("idle", "");
		const input = host.querySelector("#search") as HTMLInputElement;
		input.focus();
		input.value = "haibun";
		input.setSelectionRange(3, 3);
		expect(document.activeElement).toBe(input);

		// Simulate an incoming event that changes a sibling field (the status line)
		// while the input holds focus + a partial selection.
		renderWithStatus("loaded 12 emails", "haibun");

		const afterInput = host.querySelector("#search") as HTMLInputElement;
		// Same DOM node — lit didn't recreate it.
		expect(afterInput).toBe(input);
		// Focus survived.
		expect(document.activeElement).toBe(afterInput);
		// Value survived.
		expect(afterInput.value).toBe("haibun");
		// Cursor position survived.
		expect(afterInput.selectionStart).toBe(3);
		expect(afterInput.selectionEnd).toBe(3);
		// And the sibling that legitimately changed reflects the new state.
		expect(host.querySelector(".status")?.textContent).toBe("loaded 12 emails");
	});

	it("preserves custom-element children with internal state across re-renders", () => {
		// shu's templates compose custom elements (shu-combobox, shu-kihan-chat, etc.)
		// that own internal state in fields. Lit must keep the same instance across
		// re-renders so its state (open dropdown, typed-ahead text, focus, attached
		// listeners) survives parent re-renders.
		class StateCarrier extends HTMLElement {
			public state = "untouched";
		}
		if (!customElements.get("test-carrier")) customElements.define("test-carrier", StateCarrier);

		const renderShell = (status: string) => render(html`<div class="status">${status}</div><test-carrier id="c1"></test-carrier>`, host);

		renderShell("idle");
		const carrier = host.querySelector("#c1") as StateCarrier;
		carrier.state = "user-typed";

		renderShell("incoming");

		const afterCarrier = host.querySelector("#c1") as StateCarrier;
		expect(afterCarrier).toBe(carrier);
		expect(afterCarrier.state).toBe("user-typed");
	});

	it("does NOT clobber user typed-ahead text when re-rendering with an unchanged binding", () => {
		// Documents the safe contract: if a render fires for reasons unrelated to the
		// input (incoming SSE event, sibling status change), and the input's bound value
		// hasn't actually changed in the parent state, lit's diff sees no change for the
		// `.value` binding and leaves the live `<input>` untouched. The user's typed-ahead
		// text and cursor survive.
		renderWithStatus("idle", "hello");
		const input = host.querySelector("#search") as HTMLInputElement;
		input.focus();
		input.value = "hello world";
		input.setSelectionRange(11, 11);

		// Re-render with the SAME bound value but a changed sibling.
		renderWithStatus("loaded 12 emails", "hello");
		const afterInput = host.querySelector("#search") as HTMLInputElement;
		expect(afterInput).toBe(input);
		expect(afterInput.value).toBe("hello world");
		expect(afterInput.selectionStart).toBe(11);
		expect(document.activeElement).toBe(afterInput);
	});
});
