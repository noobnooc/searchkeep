import { llmsFullTxt } from '#lib/llms.ts';

export const prerender = true;

export function GET() {
  return new Response(llmsFullTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
