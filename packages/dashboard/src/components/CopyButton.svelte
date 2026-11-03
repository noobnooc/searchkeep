<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    text: string;
    label?: string;
  }
  let { text, label = 'Copy' }: Props = $props();
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Fallback for browsers without async clipboard access.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      copied = true;
      clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1600);
    }
  }
</script>

<button class="btn sm copy" class:copied onclick={copy} aria-label="{label}: {text}">
  <Icon name={copied ? 'check' : 'copy'} size={13} />
  <span aria-live="polite">{copied ? 'Copied' : label}</span>
</button>

<style>
  .copy.copied {
    color: var(--pos);
  }
</style>
