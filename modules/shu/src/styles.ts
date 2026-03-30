/** Shared CSS for all shu web components */
export const SHARED_STYLES = `
  :host {
    display: block;
    font-family: monospace;
    line-height: 1.6;
    color: #111;
  }
  * { box-sizing: border-box; }
  .container { padding: 8px 0; }
  h2, h3 { font-weight: normal; margin-bottom: 10px; }
  .form-group { margin-bottom: 15px; }
  label { display: block; margin-bottom: 5px; }
  input, select {
    width: 100%;
    padding: 6px;
    border: 1px solid #000;
    font-family: monospace;
  }
  button {
    background: #000;
    color: #fff;
    border: 1px solid #000;
    padding: 6px 12px;
    cursor: pointer;
    font-family: monospace;
  }
  button:hover { background: #333; }
  button.secondary { background: #fff; color: #000; }
  button.secondary:hover { background: #eee; }
  .error {
    border: 1px solid #c00;
    color: #c00;
    padding: 8px;
    margin-bottom: 10px;
    font-size: 12px;
  }
  .success {
    border: 1px solid #0a0;
    color: #0a0;
    padding: 8px;
    margin-bottom: 10px;
    font-size: 12px;
  }
  .access-badge {
    display: inline-block;
    padding: 2px 6px;
    border: 1px solid #000;
    font-size: 11px;
    margin-left: 8px;
  }
  .access-badge.public { background: #fff; }
  .access-badge.opened { background: #ddd; }
  .access-badge.private { background: #aaa; color: #fff; }
  .col-link { color: #1a73e8; text-decoration: none; cursor: pointer; }
  .col-link:hover { text-decoration: underline; }
  .pred-link { color: #7b5ea7; text-decoration: none; cursor: pointer; font-style: italic; }
  .pred-link:hover { text-decoration: underline; }
`;
