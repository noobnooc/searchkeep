// The searchkeep.dev Worker: serves the prerendered SvelteKit site that
// scripts/embed-build.mjs packed into files.generated.js.
import { FILES } from './files.generated.js';

const APEX = 'searchkeep.dev';
const decoded = new Map();

function body(file) {
  if (file.text !== undefined) return file.text;
  let bytes = decoded.get(file.etag);
  if (!bytes) {
    const bin = atob(file.b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    decoded.set(file.etag, bytes);
  }
  return bytes;
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'cross-origin-opener-policy': 'same-origin',
};

function respond(request, path, file, status = 200) {
  const headers = new Headers({ 'content-type': file.type, etag: file.etag, ...SECURITY });
  headers.set(
    'cache-control',
    path.startsWith('/_app/immutable/')
      ? 'public, max-age=31536000, immutable'
      : file.type.startsWith('text/html')
        ? 'public, max-age=0, s-maxage=300, must-revalidate'
        : 'public, max-age=3600, s-maxage=86400',
  );
  if (status === 200 && request.headers.get('if-none-match') === file.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body(file), { status, headers });
}

function resolve(path) {
  if (FILES[path] && !path.endsWith('.html')) return { file: FILES[path], path };
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return FILES['/index.html'] ? { file: FILES['/index.html'], path: '/index.html' } : null;
  for (const candidate of [`${clean}.html`, `${clean}/index.html`]) {
    if (FILES[candidate]) return { file: FILES[candidate], path: candidate };
  }
  return null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname !== APEX && url.hostname.endsWith(APEX)) {
      url.hostname = APEX;
      return Response.redirect(url.toString(), 301);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    let path = decodeURIComponent(url.pathname);
    // Canonical URLs: no ".html", no trailing slash (except the root).
    if (path.endsWith('.html') || (path.length > 1 && path.endsWith('/'))) {
      const canonical =
        path
          .replace(/\/index\.html$/, '/')
          .replace(/\.html$/, '')
          .replace(/\/+$/, '') || '/';
      if (canonical !== path && resolve(canonical)) {
        url.pathname = canonical;
        return Response.redirect(url.toString(), 301);
      }
    }
    const hit = resolve(path);
    if (hit) return respond(request, hit.path, hit.file);
    const notFound = FILES['/404.html'];
    return notFound ? respond(request, '/404.html', notFound, 404) : new Response('Not found', { status: 404 });
  },
};
