// Phase 2G: Minimal HTML/text sanitizer modeled on DOMPurify. Used wherever
// model-generated or user-pasted markup might be rendered with `dangerouslySetInnerHTML`.

const ALLOWED_TAGS = new Set([
  'B',
  'I',
  'EM',
  'STRONG',
  'CODE',
  'PRE',
  'P',
  'BR',
  'UL',
  'OL',
  'LI',
  'A',
  'H1',
  'H2',
  'H3',
]);
const ALLOWED_ATTRS = new Set(['href', 'title']);

/**
 * Strip every tag and attribute that is not on the allowlist. Anchor `href`
 * values are required to be `https://` to defeat `javascript:` and `data:`
 * URI smuggling.
 */
export function sanitizeHTML(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  if (typeof DOMParser === 'undefined') {
    // No DOM available (e.g. SSR/test). Fall back to plain-text escaping so
    // callers never see raw markup.
    return sanitizePlain(input);
  }

  const doc = new DOMParser().parseFromString(input, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];
  const visited: Element[] = [];

  let node = walker.nextNode() as Element | null;
  while (node) {
    visited.push(node);
    node = walker.nextNode() as Element | null;
  }

  for (const el of visited) {
    if (!ALLOWED_TAGS.has(el.nodeName)) {
      toRemove.push(el);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' && !attr.value.startsWith('https://')) {
        el.removeAttribute(attr.name);
      }
    }
  }

  for (const el of toRemove) {
    el.replaceWith(...Array.from(el.childNodes));
  }

  return doc.body.innerHTML;
}

/**
 * Escapes the five special HTML characters. Use whenever user-controlled text
 * is interpolated into a context that would otherwise treat it as markup.
 */
export function sanitizePlain(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}
