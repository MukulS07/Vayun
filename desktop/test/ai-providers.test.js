const test = require('node:test');
const assert = require('node:assert');
const P = require('../app/ai-providers');

// Fake keys are built at run time so this file never contains a key-shaped string (see no-secrets.test.js).
const fake = {
  nvidia: 'nv' + 'api-' + 'a'.repeat(30),
  anthropic: 'sk' + '-ant-' + 'b'.repeat(40),
  openrouter: 'sk' + '-or-' + 'c'.repeat(40),
  openai: 'sk' + '-proj-' + 'd'.repeat(40),
  openaiOld: 'sk' + '-' + 'e'.repeat(48),
  gemini: 'AI' + 'za' + 'f'.repeat(35),
  groq: 'gs' + 'k_' + 'g'.repeat(40),
  xai: 'xa' + 'i-' + 'h'.repeat(40),
};

test('ai: a pasted key is matched to the right provider', () => {
  for (const [id, key] of Object.entries(fake)) {
    const want = id === 'openaiOld' ? 'openai' : id;
    assert.strictEqual(P.detectProvider(key).id, want, id);
  }
});

test('ai: "sk-ant-" and "sk-or-" are not mistaken for OpenAI', () => {
  assert.strictEqual(P.detectProvider(fake.anthropic).id, 'anthropic');
  assert.strictEqual(P.detectProvider(fake.openrouter).id, 'openrouter');
});

test('ai: pasted extras are cleaned and junk is rejected', () => {
  assert.strictEqual(P.detectProvider(`  "${fake.groq}"\n`).id, 'groq');
  assert.strictEqual(P.detectProvider(`Authorization: Bearer ${fake.openai}`).id, 'openai');
  assert.strictEqual(P.cleanKey(`'${fake.xai}'`), fake.xai);
  assert.strictEqual(P.detectProvider(''), null);
  assert.strictEqual(P.detectProvider('hello world'), null);
  assert.strictEqual(P.detectProvider('sk-short'), null);
  assert.strictEqual(P.detectProvider(`${fake.nvidia} ${fake.nvidia}`), null);
  assert.strictEqual(P.last4(`"${fake.nvidia}"`), 'aaaa');
});

test('ai: each provider gets the request shape it expects, with the key in a header', () => {
  const msgs = [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Plan my day' }];
  const oa = P.buildRequest('openai', { key: fake.openai, model: 'gpt-4o-mini', messages: msgs });
  assert.strictEqual(oa.headers.authorization, `Bearer ${fake.openai}`);
  assert.strictEqual(JSON.parse(oa.body).messages.length, 4);
  assert.ok(!oa.url.includes(fake.openai));

  const an = P.buildRequest('anthropic', { key: fake.anthropic, model: 'claude-haiku-5-5', messages: msgs, maxTokens: 300 });
  const anBody = JSON.parse(an.body);
  assert.strictEqual(an.headers['x-api-key'], fake.anthropic);
  assert.strictEqual(anBody.system, 'Be brief.');
  assert.deepStrictEqual(anBody.messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.strictEqual(anBody.max_tokens, 300);

  const ge = P.buildRequest('gemini', { key: fake.gemini, model: 'gemini-2.0-flash', messages: msgs });
  const geBody = JSON.parse(ge.body);
  assert.ok(ge.url.endsWith('/gemini-2.0-flash:generateContent'));
  assert.ok(!ge.url.includes(fake.gemini));
  assert.strictEqual(ge.headers['x-goog-api-key'], fake.gemini);
  assert.strictEqual(geBody.systemInstruction.parts[0].text, 'Be brief.');
  assert.deepStrictEqual(geBody.contents.map(c => c.role), ['user', 'model', 'user']);
});

test('ai: replies are read from each provider format', () => {
  assert.strictEqual(P.parseResponse('openai', { choices: [{ message: { content: 'Hi' } }] }), 'Hi');
  assert.strictEqual(P.parseResponse('nvidia', { choices: [{ message: { content: 'Yo' } }] }), 'Yo');
  assert.strictEqual(P.parseResponse('anthropic', { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }), 'AB');
  assert.strictEqual(P.parseResponse('gemini', { candidates: [{ content: { parts: [{ text: 'G' }, { text: '!' }] } }] }), 'G!');
  assert.strictEqual(P.parseResponse('openai', {}), '');
  assert.strictEqual(P.parseResponse('openai', null), '');
});

test('ai: errors are sorted into what to do next', () => {
  assert.strictEqual(P.classifyError(401, ''), 'auth');
  assert.strictEqual(P.classifyError(403, 'permission denied'), 'auth');
  assert.strictEqual(P.classifyError(403, 'Quota exceeded for this project'), 'quota');
  assert.strictEqual(P.classifyError(429, 'slow down'), 'quota');
  assert.strictEqual(P.classifyError(402, ''), 'quota');
  assert.strictEqual(P.classifyError(503, ''), 'busy');
  assert.strictEqual(P.classifyError(529, ''), 'busy');
  assert.strictEqual(P.classifyError(404, ''), 'model');
  assert.strictEqual(P.classifyError(400, 'The model `x` does not exist'), 'model');
  assert.strictEqual(P.classifyError(400, 'messages must not be empty'), 'bad');
});

test('ai: Auto uses the quick model for short asks and the strong one for long ones; a typed model wins', () => {
  assert.strictEqual(P.pickModel('openai', { tier: 'auto', chars: 400 }), 'gpt-4o-mini');
  assert.strictEqual(P.pickModel('openai', { tier: 'auto', chars: 9000 }), 'gpt-4o');
  assert.strictEqual(P.pickModel('openai', { tier: 'smart' }), 'gpt-4o');
  assert.strictEqual(P.pickModel('openai', { tier: 'fast' }), 'gpt-4o-mini');
  assert.strictEqual(P.pickModel('openai', { tier: 'smart', model: 'my-model' }), 'my-model');
  assert.strictEqual(P.pickModel('nope', {}), '');
});

test("ai: the project's own Gemini request uses a token and the regional address, with no API key", () => {
  const r = P.buildVertexRequest({ project: "vayun-12d1b", location: "us-central1", model: "gemini-2.0-flash", token: "tok123", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }] });
  assert.ok(r.url.startsWith("https://us-central1-aiplatform.googleapis.com/v1/projects/vayun-12d1b/locations/us-central1/publishers/google/models/gemini-2.0-flash:generateContent"));
  assert.strictEqual(r.headers.authorization, "Bearer tok123");
  assert.ok(!("x-goog-api-key" in r.headers));
  const body = JSON.parse(r.body);
  assert.strictEqual(body.systemInstruction.parts[0].text, "Be brief.");
  assert.strictEqual(body.contents[0].role, "user");
});

test("ai: AI/ML API keys (32 hex characters, no prefix) are recognised by shape and nothing else is mistaken for them", () => {
  const hex = "c0".repeat(16);
  const p = P.detectProvider(hex);
  assert.strictEqual(p.id, "aimlapi");
  assert.strictEqual(p.format, "openai");
  assert.strictEqual(P.detectProvider("c0".repeat(15) + "c"), null);       // 31 characters
  assert.strictEqual(P.detectProvider("c0".repeat(16) + "0"), null);       // 33 characters
  assert.strictEqual(P.detectProvider("z".repeat(32)), null);              // not hex
  const req = P.buildRequest("aimlapi", { key: hex, model: "openai/gpt-5-5", messages: [{ role: "user", content: "Hi" }] });
  assert.strictEqual(req.url, "https://api.aimlapi.com/v1/chat/completions");
  assert.strictEqual(req.headers.authorization, "Bearer " + hex);
});

test("ai: a key that is out of money counts as out of allowance, so the next key takes over; Groq uses models it really has", () => {
  assert.strictEqual(P.classifyError(403, "You've run out of funds. Please top up your balance"), "quota");
  assert.strictEqual(P.classifyError(403, "invalid api key"), "auth");
  assert.strictEqual(P.PROVIDERS.groq.fast, "openai/gpt-oss-20b");
  assert.strictEqual(P.PROVIDERS.groq.smart, "openai/gpt-oss-120b");
});
