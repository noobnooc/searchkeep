<script lang="ts" module>
  // 24×24 stroke icons, drawn for this dashboard.
  const PATHS = {
    overview: 'M5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5zM15 3.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5zM5 13.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5zM15 13.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5z',
    funnel: 'M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z',
    performance: 'M4 19.5h16M5 15l4.5-5 4 3.5L20 6',
    compare: 'M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4',
    opportunities: 'M12 3l2.2 5.6L20 9.5l-4.4 3.9L17 19l-5-3-5 3 1.4-5.6L4 9.5l5.8-.9z',
    bot: 'M12 3v3M6.5 7h11A2.5 2.5 0 0 1 20 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-6A2.5 2.5 0 0 1 6.5 7zM9 12h.01M15 12h.01M2 12v2M22 12v2',
    referral: 'M7 17L17 7M8 7h9v9',
    technical: 'M12 13l3.5-3.5M4.6 17a8.5 8.5 0 1 1 14.8 0',
    settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6L6 18',
    alert: 'M12 4l9 16H3zM12 10v4M12 17.2v.01',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01',
    chevronDown: 'M6 9l6 6 6-6',
    chevronRight: 'M9 6l6 6-6 6',
    arrowRight: 'M5 12h14M13 6l6 6-6 6',
    arrowUp: 'M12 19V5M6 11l6-6 6 6',
    arrowDown: 'M12 5v14M6 13l6 6 6-6',
    copy: 'M9 9h10v11H9zM5 15H4V4h11v1',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
    refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    menu: 'M4 7h16M4 12h16M4 17h16',
    sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
    monitor: 'M3.5 5h17v11h-17zM9 20h6M12 16v4',
    calendar: 'M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5V7M15.5 3.5V7',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    sync: 'M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    shield: 'M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z',
    key: 'M14.5 13.5a5 5 0 1 0-4.6-3.1L3.5 16.8V20.5h3.7l.8-.8v-2h2v-2h2l1.1-1.1a5 5 0 0 0 1.4-1.1zM16.5 7.5v.01',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9h17M3.5 15h17M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z',
    terminal: 'M4 5h16v14H4zM8 10l2.5 2.5L8 15M13 15h3',
    sparkle: 'M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2',
    file: 'M6 3.5h8l4 4V20.5H6zM14 3.5V8h4',
    trendDown: 'M4 7l6 6 4-4 6 6M20 10v5h-5',
    dot: 'M12 12.01v-.01',
    plus: 'M12 5v14M5 12h14',
    trash: 'M5 7h14M10 11v6M14 11v6M6.5 7l1 13h9l1-13M9.5 7V4.5h5V7',
    edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 8.5l2 2',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    size?: number;
    stroke?: number;
    class?: string;
  }
  let { name, size = 16, stroke = 1.75, class: className = '' }: Props = $props();
</script>

<svg
  class="icon {className}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"><path d={PATHS[name]} /></svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
