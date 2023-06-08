import { parseLinks } from "./data-access.js";

// Example usage:
const html = `
<html>
<body>
    <a href="https://example.com">Example Link 1</a>
    <a href="https://google.com">Example Link 2</a>
    <a href="https://github.com">Example Link 3</a>
</body>
</html>
`;

const links = parseLinks(html);
console.log(links);