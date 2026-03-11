/**
 * Injects event capture scripts into browser pages
 */

import { Page, BrowserContext } from 'playwright';
import { TInteraction } from './types.js';

export type TInteractionCallback = (interaction: TInteraction) => void;

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

/**
 * Instruments a page to capture interactions
 */
export const instrumentPage = async (
  page: Page,
  onInteraction: TInteractionCallback
): Promise<void> => {
  // Expose the capture function to the page
  await page.exposeFunction('__haibunRecorderCapture', (interaction: TInteraction) => {
    onInteraction(interaction);
  });

  // Inject the capture script (runs on every navigation)
  await page.addInitScript(CAPTURE_SCRIPT);
};

/**
 * Instruments a browser context to capture interactions on all pages
 */
export const instrumentContext = (
  context: BrowserContext,
  onInteraction: TInteractionCallback
): Promise<void> => {
  // Track navigation events at context level
  context.on('page', async (page) => {
    await instrumentPage(page, onInteraction);

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        onInteraction({
          type: 'navigation',
          url: frame.url(),
        });
      }
    });
  });
  return Promise.resolve();
};
