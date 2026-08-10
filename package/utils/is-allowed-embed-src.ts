// Allowlist for iframe `src` URLs (HTTPS YouTube / Vimeo / SoundCloud only).
// Host apps should also set CSP frame-src via recommendedEmbedFrameSrcCsp().

const ALLOWED_EMBEDS: { host: string; pathPrefix: string }[] = [
  { host: 'www.youtube.com', pathPrefix: '/embed/' },
  { host: 'youtube.com', pathPrefix: '/embed/' },
  { host: 'www.youtube-nocookie.com', pathPrefix: '/embed/' },
  { host: 'youtube-nocookie.com', pathPrefix: '/embed/' },
  { host: 'player.vimeo.com', pathPrefix: '/video/' },
  { host: 'w.soundcloud.com', pathPrefix: '/player' },
];

export const ALLOWED_EMBED_FRAME_ORIGINS = [
  'https://www.youtube.com',
  'https://youtube.com',
  'https://www.youtube-nocookie.com',
  'https://youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://w.soundcloud.com',
] as const;

/** CSP `frame-src` value for hosts embedding DdocEditor. */
export function recommendedEmbedFrameSrcCsp(
  extraOrigins: readonly string[] = [],
): string {
  const origins = new Set<string>([
    "'self'",
    ...ALLOWED_EMBED_FRAME_ORIGINS,
    ...extraOrigins,
  ]);
  return Array.from(origins).join(' ');
}

export function isAllowedEmbedSrc(src: unknown): src is string {
  if (typeof src !== 'string' || !URL.canParse(src)) return false;
  const url = new URL(src);
  if (url.protocol !== 'https:') return false;
  return ALLOWED_EMBEDS.some(
    ({ host, pathPrefix }) =>
      url.hostname === host && url.pathname.startsWith(pathPrefix),
  );
}
