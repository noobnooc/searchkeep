<script lang="ts">
  // Preferences kept in this browser, and who is signed in.
  import Card from '../../components/Card.svelte';
  import Segmented from '../../components/Segmented.svelte';
  import { ui, type ThemePref } from '../../lib/state.svelte';
</script>

<Card title="Appearance" subtitle="Kept in this browser only">
  <div class="rows">
    <div class="pref">
      <div>
        <span class="name">Theme</span>
        <span class="hint">System follows your device's light or dark setting.</span>
      </div>
      <Segmented
        label="Theme"
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value={ui.theme}
        onchange={(v: ThemePref) => ui.setTheme(v)} />
    </div>
    <div class="pref">
      <div>
        <span class="name">Signed in as</span>
        <span class="hint">Through Cloudflare Access. Its policy in Cloudflare Zero Trust decides who may sign in.</span>
      </div>
      <div class="who">
        <span class="value truncate">{ui.status?.identity?.email ?? 'unknown'}</span>
        <!-- Access ends the session at this path on every protected domain; dev mode has no Access. -->
        {#if !ui.status?.dev}<a class="btn sm" href="/cdn-cgi/access/logout">Sign out</a>{/if}
      </div>
    </div>
  </div>
  {#snippet footer()}
    <span>Searchkeep sends no telemetry and loads nothing from third parties.</span>
  {/snippet}
</Card>

<style>
  .rows {
    display: flex;
    flex-direction: column;
  }
  .pref {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    flex-wrap: wrap;
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }
  .pref:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .pref:last-child {
    padding-bottom: 0;
  }
  .pref > div:first-child {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-size: 13.5px;
    font-weight: 550;
  }
  .hint {
    font-size: 12px;
    color: var(--text-3);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    max-width: 100%;
  }
  .value {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text-2);
    max-width: 100%;
  }
</style>
