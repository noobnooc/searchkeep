/** Minimal hash router: `#/view/sub?key=value`. */

export type ViewId =
  | 'overview'
  | 'geo'
  | 'performance'
  | 'compare'
  | 'opportunities'
  | 'ai-crawlers'
  | 'ai-referrals'
  | 'technical'
  | 'settings'
  | 'app-overview'
  | 'app-acquisition'
  | 'app-reviews'
  | 'app-stability';

/** Views of the Apps area (ADR 0009). */
export const APP_VIEWS: ViewId[] = ['app-overview', 'app-acquisition', 'app-reviews', 'app-stability'];

const VIEWS: ViewId[] = [
  'overview',
  'geo',
  'performance',
  'compare',
  'opportunities',
  'ai-crawlers',
  'ai-referrals',
  'technical',
  'settings',
  'app-overview',
  'app-acquisition',
  'app-reviews',
  'app-stability',
];

interface Route {
  view: ViewId;
  sub: string | undefined;
  params: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  const segs = path.split('/').filter(Boolean);
  const view = (VIEWS as string[]).includes(segs[0] ?? '') ? (segs[0] as ViewId) : 'overview';
  return { view, sub: segs[1], params: new URLSearchParams(query) };
}

class Router {
  route = $state.raw<Route>(parse());

  constructor() {
    window.addEventListener('hashchange', () => {
      this.route = parse();
    });
  }

  get view(): ViewId {
    return this.route.view;
  }

  get sub(): string | undefined {
    return this.route.sub;
  }
}

export const router = new Router();

export function href(view: ViewId, sub?: string): string {
  return `#/${view}${sub ? `/${sub}` : ''}`;
}

export function navigate(view: ViewId, sub?: string): void {
  window.location.hash = href(view, sub);
}
