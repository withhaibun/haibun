import { css } from "lit";

export const controls  = css`ul {
  list-style: none;
}
.ok-true::before,
.ok-false::before {
  position: absolute;
  left: -5px; /* Adjust this value to move it further or closer */
}
.ok-false::before {
  content: '✕ ';
  color: red;
  position: absolute;
  padding-left: 33px;
}
.ok-true::before {
  content: '✓ ';
  color: green;
  position: absolute;
  padding-left: 33px;
}

.status {
  display: inline-block;
  width: 40px;
  text-align: right;
  color: darkgray;
}

h1,
h2,
h3 {
  display: block;
  margin-block-start: 0.83em;
  margin-block-end: 0.83em;
  margin-inline-start: 0px;
  margin-inline-end: 0px;
  font-weight: bold;
}

h2 {
  font-size: 1.5em;
}

.code {
  font-family: monospace;
  white-space: pre-wrap;
}

`;