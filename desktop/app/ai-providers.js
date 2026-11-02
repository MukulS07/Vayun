// AI providers: tells which service an API key belongs to, builds the request each service expects and reads its
// answer. No network and no DOM in here, so the app, the website and the server functions all share one copy
// (tools/sync-ai.js copies it into functions/ before a deploy) and tests can run it directly.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioAiProviders = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // `fast` and `smart` are what the Auto / Fast / Smart choice maps to. Anything else can still be typed in by hand.
  const PROVIDERS = {
    anthropic: {
      id: 'anthropic', name: 'Anthropic (Claude)', format: 'anthropic', url: 'https://api.anthropic.com/v1/messages',
      keyRe: /^sk-ant-[A-Za-z0-9_-]{20,}$/, keyHelp: 'https://console.anthropic.com/settings/keys',
      fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5', models: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    },
    openrouter: {
      id: 'openrouter', name: 'OpenRouter', format: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions',
      keyRe: /^sk-or-[A-Za-z0-9_-]{20,}$/, keyHelp: 'https://openrouter.ai/keys',
      fast: 'openai/gpt-4o-mini', smart: 'openai/gpt-4o', models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
    },
    openai: {
      id: 'openai', name: 'OpenAI', format: 'openai', url: 'https://api.openai.com/v1/chat/completions',
      keyRe: /^sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/, keyHelp: 'https://platform.openai.com/api-keys',
      fast: 'gpt-4o-mini', smart: 'gpt-4o', models: ['gpt-4o-mini', 'gpt-4o'],
    },
    gemini: {
      id: 'gemini', name: 'Google Gemini', format: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      keyRe: /^AIza[A-Za-z0-9_-]{30,}$/, keyHelp: 'https://aistudio.google.com/app/apikey',
      fast: 'gemini-2.0-flash', smart: 'gemini-2.5-pro', models: ['gemini-2.0-flash', 'gemini-2.5-pro'],
    },
    groq: {
      id: 'groq', name: 'Groq', format: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions',
      keyRe: /^gsk_[A-Za-z0-9]{20,}$/, keyHelp: 'https://console.groq.com/keys',
      fast: 'openai/gpt-oss-20b', smart: 'openai/gpt-oss-120b', models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
    },
    xai: {
      id: 'xai', name: 'xAI (Grok)', format: 'openai', url: 'https://api.x.ai/v1/chat/completions',
      keyRe: /^xai-[A-Za-z0-9]{20,}$/, keyHelp: 'https://console.x.ai',
      fast: 'grok-2-latest', smart: 'grok-2-latest', models: ['grok-2-latest'],
    },
    aimlapi: {
      id: 'aimlapi', name: 'AI/ML API', format: 'openai', url: 'https://api.aimlapi.com/v1/chat/completions',
      keyRe: /^[A-Fa-f0-9]{32}$/, keyHelp: 'https://aimlapi.com/app/keys', weak: true, // no prefix: recognised by shape only
      fast: 'gpt-4o-mini', smart: 'openai/gpt-5-5', models: ['gpt-4o-mini', 'openai/gpt-5-5'],
    },
    nvidia: {
      id: 'nvidia', name: 'NVIDIA', format: 'openai', url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      keyRe: /^nvapi-[A-Za-z0-9_-]{10,}$/, keyHelp: 'https://build.nvidia.com',
      fast: 'nvidia/nemotron-3.5-lightning-30b-a3b', smart: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      models: ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3-ultra-550b-a55b'],
    },
  };
  // More specific prefixes first: "sk-ant-" and "sk-or-" would otherwise match OpenAI's broader "sk-".
  const DETECT_ORDER = ['anthropic', 'openrouter', 'xai', 'groq', 'nvidia', 'gemini', 'openai', 'aimlapi'];

  // Cleans what people paste: spaces, newlines and quotes around the key, an "Authorization: Bearer" prefix.
  const cleanKey = raw => String(raw ?? '').trim().replace(/^authorization:\s*/i, '').replace(/^bearer\s+/i, '').replace(/^["'`]+|["'`]+$/g, '').trim();

  // Returns the provider a key belongs to, or null when it is not recognised.
  function detectProvider(raw) {
    const key = cleanKey(raw);
    if (!key || /\s/.test(key)) return null;
    for (const id of DETECT_ORDER) if (PROVIDERS[id].keyRe.test(key)) return PROVIDERS[id];
    return null;
  }

  const last4 = raw => cleanKey(raw).slice(-4);

  // Which model a tier means for a provider. Auto picks the cheaper one for short asks.
  function pickModel(provider, { tier = 'auto', chars = 0, model = '' } = {}) {
    const p = typeof provider === 'string' ? PROVIDERS[provider] : provider;
    if (!p) return '';
    const typed = String(model || '').trim().slice(0, 120);
    if (typed) return typed;
    if (tier === 'smart') return p.smart;
    if (tier === 'fast') return p.fast;
    return chars > 2500 ? p.smart : p.fast;
  }

  // The request a provider expects. messages: [{ role: 'system'|'user'|'assistant', content }].
  // The key travels in a header, never in the address, so it cannot end up in a log of web addresses.
  function buildRequest(provider, { key, model, messages, maxTokens = 1500, temperature = 0.4 }) {
    const p = typeof provider === 'string' ? PROVIDERS[provider] : provider;
    if (!p) throw new Error('Unknown provider.');
    const k = cleanKey(key);
    const msgs = (messages || []).map(m => ({ role: m.role, content: String(m.content ?? '') }));
    const system = msgs.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const turns = msgs.filter(m => m.role !== 'system');
    if (p.format === 'anthropic') {
      return {
        url: p.url,
        headers: { 'content-type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, ...(system ? { system } : {}), messages: turns.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })) }),
      };
    }
    if (p.format === 'gemini') {
      return {
        url: p.url.replace('{model}', encodeURIComponent(model)),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': k },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: turns.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        }),
      };
    }
    return {
      url: p.url,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` },
      body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens, temperature, stream: false, ...(p.id === 'nvidia' && /nemotron/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {}), ...(p.id === 'groq' && /gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {}) }),
    };
  }

  // Gemini through the project's own Google Cloud account (Vertex AI). The server proves who it is with its service
  // account token, so there is no API key. Same body and answer format as Gemini above.
  function buildVertexRequest({ project, location = 'us-central1', model, messages, token, maxTokens = 1500, temperature = 0.4 }) {
    const g = buildRequest('gemini', { key: 'unused', model, messages, maxTokens, temperature });
    return {
      url: `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: g.body,
    };
  }

  // The reply text from a provider's JSON answer, or '' when there is none.
  function parseResponse(provider, json) {
    const p = typeof provider === 'string' ? PROVIDERS[provider] : provider;
    if (!p || !json || typeof json !== 'object') return '';
    if (p.format === 'anthropic') return (json.content || []).filter(c => c && c.type === 'text').map(c => c.text).join('');
    if (p.format === 'gemini') return ((json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || []).map(x => x.text || '').join('');
    const m = json.choices && json.choices[0] && json.choices[0].message;
    return m && typeof m.content === 'string' ? m.content : '';
  }

  // What went wrong, in terms the caller can act on:
  //   auth      the key is wrong or switched off          -> tell the person, do not retry
  //   quota     out of free allowance or rate limited     -> try the next key, or wait
  //   busy      the service is overloaded or down         -> try the next key
  //   model     that model name is not available          -> pick another model
  //   bad       anything else about the request
  function classifyError(status, bodyText = '') {
    const t = String(bodyText).toLowerCase();
    if (status === 401 || status === 403) return /quota|billing|credit|exceeded|funds|balance|top up|payment/.test(t) && status === 403 ? 'quota' : 'auth';
    if (status === 402 || status === 429) return 'quota';
    if (status === 529 || status >= 500) return 'busy';
    if (status === 404 || (status === 400 && /model/.test(t) && /(not found|does not exist|invalid|unsupported|unknown)/.test(t))) return 'model';
    if (/quota|rate.?limit|insufficient|billing|credit|out of funds/.test(t)) return 'quota';
    return 'bad';
  }

  const list = () => Object.values(PROVIDERS).map(p => ({ id: p.id, name: p.name, fast: p.fast, smart: p.smart, models: p.models.slice(), keyHelp: p.keyHelp }));

  return { PROVIDERS, cleanKey, detectProvider, last4, pickModel, buildRequest, buildVertexRequest, parseResponse, classifyError, list };
});
