export const dashboard = (element: string) => {
 return `
<div class="haibun-header" style="position: fixed; top: 0; left: 0; width: 100%; background-color: white; z-index: 1000; display: flex; align-items: center;">
  <h1 style="margin-right: auto;">Haibun Dashboard</h1>
  <div className="haibun-controls" style="padding: 10px; flex-grow: 1; max-width: 80%;">
    <label for="haibun-debug-level-select">Log level</label>
    <select id="haibun-debug-level-select">
      <option value="error">Error</option>
      <option value="info">Info</option>
      <option value="log" selected>Log</option>
      <option value="debug">Debug</option>
    </select>
  </div>
  </div>
  <div class="haibun-dashboard-output" style="padding-top: 100px; box-sizing: border-box;">
    <div style="height: calc(100% - 100px); width: 100%; overflow: auto" id="${element}"></div>
    <div class="haibun-disappears"><div class="haibun-loader"></div>Execution output will appear here.</div>
  </div>
<script>
// when the select is changed, the .haibun-level-{level} css visbility should change so all levels "lower" than current aren't visibleo
// order: debug, log, info, error

  const levelSelect = document.getElementById('haibun-debug-level-select');
  const levels = ['debug', 'log', 'info', 'error'];

  const updateStyles = (selectedLevel) => {
    const selectedIndex = levels.indexOf(selectedLevel);
    let css = '';

    levels.forEach((level, index) => {
      if (index < selectedIndex) {
        css += \`div.haibun-log-container.haibun-level-\${level} { display: none !important; }\n\`;
      } else {
        css += \`div.haibun-log-container.haibun-level-\${level} { display: flex !important; }\n\`;
      }
    });


  let styleElement = document.getElementById('haibun-dynamic-styles');
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'haibun-dynamic-styles';
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = css;
  }

  levelSelect.addEventListener('change', (event) => {
  console.log('change', event.target.value)
    updateStyles(event.target.value);
  });
// Initial style update
updateStyles(levelSelect.value);
</script>
`;
};

