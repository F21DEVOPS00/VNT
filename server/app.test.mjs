import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.mjs';
import { createDeliveryStore } from './services.mjs';
const result = { title: '운영 회의', summary: '금요일까지 사진을 전달합니다.', decisions: ['사진 교체'], actions: [{ task: '사진 전달', owner: null, due: '금요일' }], openQuestions: [] };
const token = 'test-only-token';
const authHeader = { Authorization: `Bearer ${token}` };
const gateway = { transcribe: async () => '사진을 금요일까지 전달합니다.', summarize: async () => result };

test('unauthenticated clients cannot trigger paid transcription, summaries, or email', async () => {
  let calls = 0;
  const app = createApp({ token, gateway: { transcribe: () => calls++, summarize: () => calls++ } });
  for (const route of ['/transcribe', '/summarize', '/send-email']) await request(app).post(route).send({}).expect(401);
  assert.equal(calls, 0);
});
test('audio is readable during transcription and temporary upload is removed afterwards', async () => {
  let uploaded;
  const app = createApp({ token, gateway: { ...gateway, transcribe: async file => { uploaded = file.path; await access(uploaded); return '테스트 회의'; } } });
  const response = await request(app).post('/transcribe').set(authHeader).attach('audio', Buffer.from('fake audio for transport testing'), 'meeting.m4a').expect(200);
  assert.equal(response.body.transcript, '테스트 회의');
  // Wait for the asynchronous route finally block, rather than testing an arbitrary delay.
  for (let i = 0; i < 100; i++) { try { await access(uploaded); } catch { return; } await new Promise(resolve => setImmediate(resolve)); }
  await assert.rejects(access(uploaded));
});
test('upload limits and unsupported files are rejected before calling the AI', async () => {
  const app = createApp({ token, gateway, maxBytes: 4 });
  await request(app).post('/transcribe').set(authHeader).attach('audio', Buffer.from('too large'), 'meeting.m4a').expect(413);
  await request(app).post('/transcribe').set(authHeader).attach('audio', Buffer.from('x'), 'file.exe').expect(400);
});
test('summary validation preserves unspecified owners instead of making them up', async () => {
  const app = createApp({ token, gateway });
  const response = await request(app).post('/summarize').set(authHeader).send({ transcript: '사진을 금요일까지 전달합니다.' }).expect(200);
  assert.equal(response.body.result.actions[0].owner, null);
  await request(app).post('/summarize').set(authHeader).send({ transcript: ' ' }).expect(400);
});
test('email attempts are deduplicated across a store restart without persisting meeting text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vnt-test-'));
  try {
    const path = join(directory, 'delivery.json');
    let sent = 0;
    const mailer = { send: async () => { sent++; } };
    let app = createApp({ token, gateway, mailer, deliveries: await createDeliveryStore(path) });
    const body = { id: 'attempt-1', recipients: ['someone@example.com'], title: '회의', text: 'private meeting contents' };
    await request(app).post('/send-email').set(authHeader).send(body).expect(200);
    app = createApp({ token, gateway, mailer, deliveries: await createDeliveryStore(path) });
    const response = await request(app).post('/send-email').set(authHeader).send(body).expect(200);
    assert.equal(sent, 1);
    assert.equal(response.body.deduplicated, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('uncertain email delivery is not retried automatically', async () => {
  const entries = new Map(); let calls = 0;
  const deliveries = { get: key => entries.get(key), set: async (key, value) => entries.set(key, value) };
  const app = createApp({ token, gateway, deliveries, mailer: { send: async () => { calls++; throw new Error('SMTP disconnected'); } } });
  const body = { id: 'attempt-2', recipients: ['someone@example.com'], title: '회의', text: 'contents' };
  await request(app).post('/send-email').set(authHeader).send(body).expect(502);
  await request(app).post('/send-email').set(authHeader).send(body).expect(409);
  assert.equal(calls, 1);
});
test('public mode requires a verified individual account, not the development shared token', async () => {
  const auth = { verify: async token => token === 'real-user' ? { id: 'user-1', email_confirmed_at: '2026-10-21' } : null };
  const app = createApp({ token, auth, gateway });
  await request(app).post('/summarize').set(authHeader).send({ transcript: '회의' }).expect(401);
  await request(app).post('/summarize').set({ Authorization: 'Bearer real-user' }).send({ transcript: '회의' }).expect(200);
});
