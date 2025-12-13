import { JITSerializer } from '@haibun/core/monitor/index.js';
export async function serializeState(events: unknown[], title = "Haibun Test Trace") {
  // 1. Get current HTML
  const html = document.documentElement.outerHTML;

  // 2. Embed events data as script tag
  const dataScript = `<script id="haibun-data" type="application/json">${JSON.stringify(events)}</script>`;

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
export function getInitialState() {
  const el = document.getElementById('haibun-data');
  if (el && el.textContent) {
    try {
      const serializer = new JITSerializer();
      return serializer.deserialize(el.textContent);
    } catch (e) {
      console.error("Failed to parse embedded data", e);
    }
  }
  return null;
}
