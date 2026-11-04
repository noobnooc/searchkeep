<script lang="ts">
  import { dateTime } from '../lib/format';
  import type { StatusResponse } from '../lib/types';
  import Horizon from './Horizon.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';

  interface Props {
    status: StatusResponse;
    checking: boolean;
    onrecheck: () => void;
  }
  let { status, checking, onrecheck }: Props = $props();

  const origin = window.location.origin;
  const host = window.location.host;

  interface Copy {
    title: string;
    lead: string;
    steps: string[];
  }
  const copy = $derived.by((): Copy => {
    switch (status.state) {
      case 'oauth_disabled':
        return {
          title: 'Enable Managed OAuth',
          lead: `Cloudflare Access protects ${host}, but its Managed OAuth is off. MCP clients such as Claude and Cursor need it to sign in, so Searchkeep stays locked until it is on.`,
          steps: [
            'Open Cloudflare Zero Trust and go to Access → Applications.',
            `Edit the self-hosted application that protects ${host}.`,
            'Turn on Managed OAuth (it enables dynamic client registration and PKCE for MCP clients) and save.',
            'Come back here and select Check again.',
          ],
        };
      case 'policy_too_broad':
        return {
          title: 'Tighten your Access policy',
          lead: `The Access policy for ${host} lets in more than specific people. Searchkeep holds your search data, so it stays locked until only you (and the people you choose) can sign in.`,
          steps: [
            `In Cloudflare Zero Trust, open Access → Applications → the application for ${host} → Policies.`,
            'Change the Allow policy to include only specific email addresses: avoid "Everyone", public email domains such as gmail.com, and broad groups.',
            'Save the policy, then select Check again.',
          ],
        };
      case 'no_access':
      default:
        return {
          title: 'Put Searchkeep behind Cloudflare Access',
          lead: `${host} is not protected by Cloudflare Access yet, or the Worker cannot verify the Access token. Nothing is shown until it is.`,
          steps: [
            `Create a self-hosted Access application for ${host} with a policy that allows only your email address.`,
            'Copy its Application Audience (AUD) tag and your team domain into the ACCESS_AUD and ACCESS_TEAM_DOMAIN secrets of the Worker.',
            'Reload this page through the Access login.',
          ],
        };
    }
  });
</script>

<div class="locked">
  <div class="panel" role="main">
    <div class="top">
      <Logo />
      <span class="badge"><Icon name="lock" size={13} /> Locked</span>
    </div>
    <div class="line"><Horizon state="paused" /><span class="label-mono">Sync paused until every check passes</span></div>
    <h1>{copy.title}</h1>
    <p class="lead">{copy.lead}</p>

    <ol class="steps">
      {#each copy.steps as step, i (i)}
        <li><span class="n">{i + 1}</span><span>{step}</span></li>
      {/each}
    </ol>

    <section class="checks" aria-label="Readiness checks">
      <h2>Readiness checks</h2>
      <ul>
        {#each status.checks as c (c.id)}
          <li class:fail={!c.ok}>
            <span class="mark">{#if c.ok}<Icon name="check" size={12} stroke={2.6} />{:else}<Icon name="x" size={12} stroke={2.6} />{/if}</span>
            <div>
              <span class="label">{c.label}</span>
              {#if c.detail}<span class="detail">{c.detail}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
      {#if status.configErrors.length}
        <div class="config">
          <strong>Configuration problems</strong>
          <ul>
            {#each status.configErrors as e (e)}<li>{e}</li>{/each}
          </ul>
        </div>
      {/if}
    </section>

    <div class="actions">
      <button class="btn primary" onclick={onrecheck} disabled={checking}>
        <Icon name="refresh" size={14} />
        {checking ? 'Checking…' : 'Check again'}
      </button>
      <a class="btn" href="{origin}/setup">Setup guide <Icon name="arrowRight" size={13} /></a>
    </div>
    <p class="foot">
      Locked by design: Searchkeep refuses dashboard, API and MCP access, and pauses syncing, until every check passes.
      {#if status.identity}Signed in as {status.identity.email}.{/if}
      Last checked {dateTime(status.checkedAt)}.
    </p>
  </div>
</div>

<style>
  .locked {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px 16px;
    background: var(--bg);
  }
  .panel {
    width: 100%;
    max-width: 560px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 28px;
    box-shadow: var(--shadow-pop);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--warn);
    background: var(--warn-wash);
    padding: 3px 9px;
    border-radius: 999px;
  }
  .line {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 24px;
  }
  h1 {
    font-family: var(--display);
    font-size: 24px;
    letter-spacing: -0.02em;
    font-weight: 600;
  }
  .lead {
    margin-top: 8px;
    color: var(--text-2);
    line-height: 1.6;
  }
  .steps {
    list-style: none;
    margin: 20px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .steps li {
    display: flex;
    gap: 10px;
    line-height: 1.55;
  }
  .n {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-family: var(--mono);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text);
    background: var(--surface-3);
    margin-top: 0.5px;
  }
  .checks {
    margin-top: 22px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 14px;
    background: var(--surface-2);
  }
  h2 {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 8px;
  }
  .checks ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .checks li {
    display: flex;
    gap: 9px;
    font-size: 13px;
  }
  .mark {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--pos);
    background: var(--pos-wash);
    margin-top: 1px;
  }
  .fail .mark {
    color: var(--neg);
    background: var(--neg-wash);
  }
  .label {
    display: block;
  }
  .detail {
    display: block;
    color: var(--text-3);
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }
  .config {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--neg);
  }
  .config ul {
    margin-top: 4px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 22px;
    flex-wrap: wrap;
  }
  .foot {
    margin-top: 16px;
    font-size: 12px;
    color: var(--text-3);
    line-height: 1.6;
  }
  @media (max-width: 480px) {
    .panel {
      padding: 20px;
    }
  }
</style>
