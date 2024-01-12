export const MAPPED_MEDIA_TYPES = {
  js: 'text/javascript',
  javascript: 'text/javascript',
  css: 'text/css',
  html: 'text/html',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  webm: 'video/webm',
  weba: 'audio/webm',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  '': 'inode/directory'
};

export const EMediaTypes = {
  html: 'html',
  video: 'video',
  json: 'json',
  image: 'image',
  javascript: 'js',
  directory: ''
} as const;

export const MEDIA_TYPES: { [type: string]: string; } = {
  webm: 'video',
  html: 'text/html',
  json: 'json',
  video: 'video/mp4',
  js: 'javascript',
  '': 'inode/directory'
};

// FIXME

export type TMediaType = typeof EMediaTypes[keyof typeof EMediaTypes];