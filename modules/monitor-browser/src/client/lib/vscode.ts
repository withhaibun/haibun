export const buildVSCodeUri = (path: string, lineNumber?: number): string => {
  const cleanPath = path.replace(/^file:\/\//, '');
  const lineSuffix = lineNumber ? `:${lineNumber}` : '';
  return `vscode://file/${cleanPath}${lineSuffix}`;
};
