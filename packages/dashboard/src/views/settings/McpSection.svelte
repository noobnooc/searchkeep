<script lang="ts">
  // How to connect an AI client to this deployment's MCP endpoint.
  import Card from '../../components/Card.svelte';
  import CopyButton from '../../components/CopyButton.svelte';

  const mcpUrl = `${window.location.origin}/mcp`;
  const claudeCmd = `claude mcp add --transport http searchkeep ${mcpUrl}`;
  const jsonCfg = JSON.stringify({ mcpServers: { searchkeep: { url: mcpUrl } } }, null, 2);
</script>

<Card title="Connect an AI client" subtitle="Any MCP client with Streamable HTTP and OAuth: Claude, Claude Code, Cursor and others" id="settings-mcp">
  <div class="mcp">
    <div class="kv">
      <span class="k">MCP endpoint</span>
      <div class="code-row">
        <code class="code">{mcpUrl}</code>
        <CopyButton text={mcpUrl} />
      </div>
      <span class="hint">In Claude (web, desktop and mobile): Settings → Connectors → Add custom connector, with this URL.</span>
    </div>
    <div class="kv">
      <span class="k">Claude Code</span>
      <div class="code-row">
        <code class="code">{claudeCmd}</code>
        <CopyButton text={claudeCmd} />
      </div>
      <span class="hint">Then run <code>/mcp</code> in Claude Code, select searchkeep and choose Authenticate.</span>
    </div>
    <div class="kv">
      <span class="k">Cursor (~/.cursor/mcp.json) and other clients configured with JSON</span>
      <div class="code-row top">
        <pre class="code">{jsonCfg}</pre>
        <CopyButton text={jsonCfg} />
      </div>
    </div>
  </div>
  {#snippet footer()}
    <span>The first connection opens a Cloudflare Access sign-in (Managed OAuth with PKCE). Tools are read-only unless <code>ENABLE_WRITES</code> is set.</span>
  {/snippet}
</Card>

<style>
  .mcp {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 760px;
  }
  .kv {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .k {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
  }
  .hint {
    font-size: 12px;
    color: var(--text-3);
  }
  .code-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .code-row.top {
    align-items: flex-start;
  }
  .code {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-2);
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text);
    overflow-x: auto;
    white-space: pre;
  }
</style>
