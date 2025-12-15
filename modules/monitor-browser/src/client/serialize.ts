import { JITSerializer } from '@haibun/core/monitor/index.js';

export interface SerializedState {
  events: unknown[];
  startTime: number | null;
}

export async function serializeState(events: unknown[], startTime: number | null, title = "Haibun Test Trace") {
  // 1. Get current HTML
  const html = document.documentElement.outerHTML;

  // 2. Embed events data and startTime as script tag
  const stateData: SerializedState = { events, startTime };
  const dataScript = `<script id="haibun-data" type="application/json">${JSON.stringify(stateData)}</script>`;

  // 3. Embed styles (if external) - simpler if we assume vite inlines or we fetch them
  // For now, assume vite build will bundle CSS, but for dev we might need more logic.
  // In production build, styles are usually linked. We'd need to fetch and inline them.

  // Simple approach: Inject data into body end
  const n = html.lastIndexOf('</body>');
  const finalHtml = html.substring(0, n) + dataScript + html.substring(n);

  // 4. Download
  const blob = new Blob([finalHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `haibun-trace-${new Date().toISOString()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// Helper to hydrate on load
export function getInitialState(): SerializedState | null {
  const el = document.getElementById('haibun-data');
  if (el && el.textContent) {
    try {
      const serializer = new JITSerializer();
      const parsed = JSON.parse(el.textContent);

      // Handle new format with events and startTime
      if (parsed && typeof parsed === 'object' && 'events' in parsed) {
        return {
          events: serializer.deserialize(JSON.stringify(parsed.events)),
          startTime: parsed.startTime ?? null
        };
      }

      // Backward compatibility: old format was just array of events
      if (Array.isArray(parsed)) {
        return {
          events: serializer.deserialize(el.textContent),
          startTime: null
        };
      }
    } catch (e) {
      console.error("Failed to parse embedded data", e);
    }
  }
  return null;
}
