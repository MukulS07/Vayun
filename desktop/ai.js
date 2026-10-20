// NVIDIA API (OpenAI-compatible chat completions) for the in-app assistant.
// The API key is encrypted with Electron safeStorage and never leaves the main process.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';
// Tests may point the assistant at a local fake server; only loopback hosts are accepted so a key can't be sent elsewhere.
function endpoint() {
  const o = process.env.PAGES_AI_ENDPOINT;
  if (o) { try { const u = new URL(o); if (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)) return o; } catch { /* ignore */ } }
  return NVIDIA_ENDPOINT;
}

const file = () => path.join(app.getPath('userData'), 'ai.json');
function read() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } }
function write(cfg) { fs.writeFileSync(file(), JSON.stringify(cfg)); }

function status() {
  const c = read();
  return { hasKey: Boolean(c.key), model: c.model || DEFAULT_MODEL };
}

function setKey(key, model) {
  key = String(key || '').trim();
  if (key && !/^nvapi-[A-Za-z0-9_-]{10,}$/.test(key)) return { error: 'That does not look like an NVIDIA key. It starts with "nvapi-".' };
  if (key && !safeStorage.isEncryptionAvailable()) return { error: 'Secure storage is not available on this PC, so the key was not saved.' };
  const c = read();
  if (key) c.key = safeStorage.encryptString(key).toString('base64');
  const m = String(model || '').trim();
  if (m) c.model = m.slice(0, 120);
  write(c);
  return status();
}

function clearKey() {
  const c = read();
  delete c.key;
  write(c);
  return status();
}

// messages: [{ role: 'system' | 'user' | 'assistant', content }] from the renderer; checked before sending.
async function chat(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 30) return { error: 'Bad request.' };
  const clean = messages.map(m => ({ role: ['system', 'user', 'assistant'].includes(m?.role) ? m.role : 'user', content: String(m?.content ?? '').slice(0, 24000) }));
  const c = read();
  if (!c.key) return { error: 'Add your NVIDIA API key first.' };
  let key;
  try { key = safeStorage.decryptString(Buffer.from(c.key, 'base64')); } catch { return { error: 'The saved key could not be read. Add it again.' }; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(endpoint(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: c.model || DEFAULT_MODEL, messages: clean, temperature: 0.2, max_tokens: 2000 }),
      signal: ctrl.signal,
    });
    const body = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) return { error: 'NVIDIA rejected the key. Check it at build.nvidia.com.' };
    if (r.status === 404) return { error: `Model "${c.model || DEFAULT_MODEL}" was not found. Pick another model in the assistant settings.` };
    if (!r.ok) return { error: `NVIDIA API error ${r.status}${body?.detail ? ': ' + String(body.detail).slice(0, 200) : ''}` };
    return { content: String(body?.choices?.[0]?.message?.content || '') };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'The request took too long and was stopped.' : 'Could not reach the NVIDIA API. Check your internet connection.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { status, setKey, clearKey, chat, DEFAULT_MODEL };
