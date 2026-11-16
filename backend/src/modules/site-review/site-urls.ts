/**
 * The crawl's URL rules (agents.md 5.19, Discover pages): which links are
 * pages of the site, how a page URL is written once, and a file name for a
 * page's images. Pure functions, no framework import.
 */

/** Links to files, not pages: never opened by the crawl. */
const FILE_EXTENSION =
  /\.(pdf|zip|gz|tgz|rar|7z|png|jpe?g|gif|webp|svg|ico|bmp|tiff?|mp4|mov|avi|webm|mp3|wav|ogg|docx?|xlsx?|pptx?|csv|json|xml|txt|exe|msi|dmg|apk|ics)$/i;

/**
 * The page a link points to, written once: on the site's origin, http(s),
 * no fragment, no trailing slash but the root's. Undefined for a link off
 * the site, to a file, or that is not a web address.
 */
export function pageUrlOf(href: string, origin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.origin !== origin) return undefined;
  if (FILE_EXTENSION.test(url.pathname)) return undefined;
  url.hash = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

/** A short, stable hash (FNV-1a, 8 hex characters). */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** A file name for a page's images: its path made safe, and a hash. */
export function pageFileName(url: string): string {
  let path = url;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    // Not a URL: the text itself.
  }
  const readable =
    path
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'home';
  return `${readable}-${shortHash(url)}`;
}
