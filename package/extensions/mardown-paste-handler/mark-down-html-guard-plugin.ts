/**
 * markdownHtmlGuardPlugin
 *
 * This plugin protects our Markdown content from accidentally treating
 * unknown angle-bracket text (like <APIKEY> or <PLACEHOLDER>) as real HTML.
 *
 * How it works:
 * - Markdown allows raw HTML inside documents.
 * - If someone writes something inside angle brackets, Markdown may try to
 *   interpret it as an actual HTML tag.
 * - We only want specific HTML tags (like <div>, <p>, <img>, etc.) to be allowed.
 *
 * So this plugin:
 * 1. Checks every piece of raw HTML found in the Markdown.
 * 2. If the tag is in our allowed list, it renders normally.
 * 3. If the tag is NOT allowed, it escapes the angle brackets so it
 *    appears as plain text instead of being treated as HTML.
 *
 * Example:
 *   <div>   → allowed, renders as HTML
 *   <APIKEY> → not allowed, becomes &lt;APIKEY&gt; and shows as text
 *
 * This keeps the editor safe, predictable, and prevents placeholders
 * or custom tokens from being stripped or misinterpreted.
 */

import type MarkdownIt from 'markdown-it';

const ALLOWED_HTML_TAGS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'details',
  'div',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'iframe',
  'img',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  // Inline SVG round-trips as raw markup (TEC-2680) — sanitized and encoded
  // to a data URI in handleMarkdownContent before it can reach the doc.
  'svg',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  // Video round-trips through markdown as raw HTML (see the turndown 'video'
  // rule) — without this the guard would escape it to text on import.
  'video',
]);

export function markdownHtmlGuardPlugin(md: MarkdownIt) {
  const allowedTags = ALLOWED_HTML_TAGS;

  const defaultInline =
    md.renderer.rules.html_inline ||
    function (tokens, idx, opts, _env, self) {
      return self.renderToken(tokens, idx, opts);
    };

  const defaultBlock =
    md.renderer.rules.html_block ||
    function (tokens, idx, opts, _env, self) {
      return self.renderToken(tokens, idx, opts);
    };

  function escapeIfDisallowed(content: string): string | null {
    const match = content.match(/^\s*<\/?([a-zA-Z0-9-]+)/);
    if (!match) return content;

    const tag = match[1].toLowerCase();

    if (!allowedTags.has(tag)) {
      return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return null;
  }

  md.renderer.rules.html_inline = function (tokens, idx, opts, env, self) {
    const escaped = escapeIfDisallowed(tokens[idx].content);
    if (escaped !== null) return escaped;

    return defaultInline(tokens, idx, opts, env, self);
  };

  md.renderer.rules.html_block = function (tokens, idx, opts, env, self) {
    const escaped = escapeIfDisallowed(tokens[idx].content);
    if (escaped !== null) return escaped;

    return defaultBlock(tokens, idx, opts, env, self);
  };
}
