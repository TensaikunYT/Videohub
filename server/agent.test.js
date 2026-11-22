import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildPrompt, publicAgent, providerLabel, detectReasonix } from './agent.js';

test('provider labels and the public config never expose the API key', () => {
  assert.equal(providerLabel('claude'), 'Claude');
  assert.equal(providerLabel('reasonix'), 'Reasonix');
  assert.equal(providerLabel('deepseek'), 'DeepSeek');
  const pub = publicAgent({ provider: 'deepseek', deepseekApiKey: 'sk-secret', deepseekModel: 'deepseek-chat' });
  assert.equal(pub.deepseekApiKey, '');
  assert.equal(pub.deepseekApiKeySet, true);
  assert.equal(pub.keyMask, '********');
  assert.equal(pub.provider, 'deepseek');
  assert.deepEqual(pub.providers, ['claude', 'reasonix', 'deepseek']);
});

test('the agent prompt carries every note, its picture and the truth about a code-less film', () => {
  const p = { id: 'p', name: 'Film', title: 'Film', path: path.resolve('.test-tmp', 'agent-fixture', 'film'), outputs: [] };
  const text = buildPrompt(p, [{ id: 3, t: 14.35, t2: null, kind: 'visual', text: 'remove the dead space', images: { crop: 'C:/notes/3-crop.jpg' } }]);
  assert.match(text, /#3 at 0:14\.35/);
  assert.match(text, /remove the dead space/);
  assert.match(text, /C:\/notes\/3-crop\.jpg/);
  assert.match(text, /no film code/);
});

test('Reasonix detection returns a usable shape even when the CLI is absent', () => {
  const d = detectReasonix();
  assert.equal(typeof d.ok, 'boolean');
  assert.ok(Array.isArray(d.candidates));
  if (!d.ok) assert.match(d.why, /not found/i);
});
