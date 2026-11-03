import { describe, expect, it } from 'vitest';
import { evaluateReadiness, loadConfig, type Store } from '@searchkeep/core';
import { handleMcpRequest, TOOL_NAMES } from '../src/index.js';

const store = new Proxy({} as Store, {
  get(_t, prop) {
    if (prop === 'coverage') return async () => [];
    if (prop === 'listSyncRuns') return async () => [];
    return async () => {
      throw new Error(`unexpected store call ${String(prop)}`);
    };
  },
});

function deps(extra: Record<string, string> = {}) {
  const config = loadConfig({ SITES: JSON.stringify([{ id: 'acme', domain: 'acme.com' }]), ...extra });
  return {
    ctx: { store, config, clients: {} },
    readiness: async () =>
      evaluateReadiness({
        configured: true,
        identityOk: true,
        inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] },
      }),
  };
}

async function rpc(body: unknown, d = deps()) {
  const res = await handleMcpRequest(
    new Request('https://sk.example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify(body),
    }),
    d,
  );
  return { status: res.status, json: (await res.json()) as any };
}

describe('mcp', () => {
  it('initializes statelessly', async () => {
    const { status, json } = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    expect(status).toBe(200);
    expect(json.result.serverInfo.name).toBe('searchkeep');
  });

  it('lists read-only tools and hides submit_sitemap by default', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const names = json.result.tools.map((t: any) => t.name);
    expect(names).toEqual(TOOL_NAMES.filter((n) => n !== 'submit_sitemap'));
    for (const t of json.result.tools) expect(t.annotations.readOnlyHint).toBe(true);
  });

  it('exposes submit_sitemap when writes are enabled', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, deps({ ENABLE_WRITES: 'true' }));
    const tool = json.result.tools.find((t: any) => t.name === 'submit_sitemap');
    expect(tool.annotations.readOnlyHint).toBe(false);
  });

  it('calls tools and returns errors as tool errors', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_sites', arguments: {} } });
    expect(JSON.parse(json.result.content[0].text).sites[0].id).toBe('acme');
    const bad = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'inspect_url', arguments: { url: '/x' } } });
    expect(bad.json.result.isError).toBe(true);
    expect(bad.json.result.content[0].text).toMatch(/not configured/);
  });

  it('validates arguments', async () => {
    const { json } = await rpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'query_performance', arguments: { start: 'yesterday' } },
    });
    expect(json.result?.isError ?? Boolean(json.error)).toBe(true);
  });
});
