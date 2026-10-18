/** A page's interactions captured by a script injected into it, and its main frame's navigations. */
import type { Page } from "playwright";
import type { TInteraction } from "../domains/interaction.js";
import type { TPageRecorder } from "../ports.js";

/**
 * The script that runs inside the browser page to capture interactions.
 * Serialized and injected via addInitScript.
 */
const CAPTURE_SCRIPT = `
(() => {
  if (window.__haibunRecorderInstalled) return;
  window.__haibunRecorderInstalled = true;

  const getElementInfo = (el) => {
    const labelEl = el.id ? document.querySelector(\`label[for="\${el.id}"]\`) : null;
    return {
      tagName: el.tagName,
      text: el.innerText?.slice(0, 100)?.trim(),
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      name: el.getAttribute('name'),
      id: el.id || undefined,
      href: el.getAttribute('href'),
      placeholder: el.getAttribute('placeholder'),
      label: labelEl?.textContent?.trim(),
    };
  };

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!el || !(el instanceof HTMLElement)) return;
    
    window.__haibunRecorderCapture?.({
      type: 'click',
      ...getElementInfo(el),
    });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement)) return;
    
    const labelEl = el.id ? document.querySelector(\`label[for="\${el.id}"]\`) : null;
    
    window.__haibunRecorderCapture?.({
      type: 'input',
      value: el.value,
      name: el.name || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      label: labelEl?.textContent?.trim(),
      ariaLabel: el.getAttribute('aria-label') || undefined,
      id: el.id || undefined,
    });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
      window.__haibunRecorderCapture?.({
        type: 'keypress',
        key: e.key,
      });
    }
  }, true);
})();
`;

/** Exposes the capture function to `page`, injects the capture script on every navigation, and reports each navigation of the page's main frame. */
export const pageRecorder: TPageRecorder = {
	async instrument(page: Page, onInteraction: (interaction: TInteraction) => void): Promise<void> {
		await page.exposeFunction("__haibunRecorderCapture", onInteraction);
		await page.addInitScript(CAPTURE_SCRIPT);
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) onInteraction({ type: "navigation", url: frame.url() });
		});
	},
};
