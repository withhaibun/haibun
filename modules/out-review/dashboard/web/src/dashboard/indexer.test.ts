import { parseLinks } from "./indexer.js";

describe('parseLinks', () => {
    it('should parse links', () => {
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
        expect(links).toEqual([
            'https://example.com',
            'https://google.com',
            'https://github.com',
        ]);
    });
});