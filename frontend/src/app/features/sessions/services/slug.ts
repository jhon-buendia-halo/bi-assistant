/**
 * A download file name's stem from a title, as the backend builds it for the
 * same download (api.md #14, #105): ASCII words joined by "-", lowercase, at
 * most 64 characters. Empty when the title has no ASCII letter or digit.
 */
export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}
