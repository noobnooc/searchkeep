// Every page is prerendered to static HTML. No client-side router is shipped:
// content works without JavaScript, and /site.js adds small enhancements.
export const prerender = true;
export const csr = false;
export const trailingSlash = 'never';
