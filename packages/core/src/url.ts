/**
 * Normalizes page URLs from every source to one key so GSC pages, Bing pages,
 * crawler paths and Web Analytics paths can be joined.
 *
 * - Hosts equal to the site domain or `www.` + domain are dropped: `/blog/post`
 * - Other hosts (subdomains) are kept: `//docs.acme.com/start`
 * - Query strings and fragments are dropped; an empty path becomes `/`.
 */
export function normalizePage(input: string, domain: string, host?: string): string {
  let raw = input.trim();
  let h = host?.toLowerCase();
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      h = u.hostname.toLowerCase();
      path = u.pathname;
    } catch {
      path = raw;
    }
  } else if (raw.startsWith('//')) {
    const rest = raw.slice(2);
    const slash = rest.indexOf('/');
    h = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
    path = slash === -1 ? '/' : rest.slice(slash);
  } else {
    path = raw;
  }
  path = path.split('#')[0]!.split('?')[0]!;
  if (!path.startsWith('/')) path = `/${path}`;
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (!h || h === d || h === `www.${d}`) return path;
  return `//${h}${path}`;
}

/** Turns a normalized page key back into an absolute URL for display or API calls. */
export function pageToUrl(page: string, domain: string): string {
  if (page.startsWith('//')) return `https:${page}`;
  return `https://${domain}${page}`;
}

/** Whether a URL may be fetched for a site: http(s) on the site's domain or one of its subdomains. */
export function onSiteDomain(url: string, domain: string): boolean {
  try {
    const u = new URL(url);
    const d = domain.toLowerCase().replace(/^www\./, '');
    const host = u.hostname.toLowerCase();
    return (u.protocol === 'https:' || u.protocol === 'http:') && (host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
