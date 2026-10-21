import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

export const summarySchema = z.object({
  title: z.string(), summary: z.string(), decisions: z.array(z.string()),
  actions: z.array(z.object({ task: z.string(), owner: z.string().nullable(), due: z.string().nullable() })),
  openQuestions: z.array(z.string()),
});
export const summaryJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { task: { type: 'string' }, owner: { type: ['string', 'null'] }, due: { type: ['string', 'null'] } },
      required: ['task', 'owner', 'due'] } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  }, required: ['title', 'summary', 'decisions', 'actions', 'openQuestions'],
};
export function createApp({ token, gateway, auth, mailer, deliveries, configured = true, maxBytes = 24 * 1024 * 1024 }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: false }));
  app.get('/health', (_, res) => res.json({ ok: true, aiConfigured: configured, authMode: auth ? 'account' : 'development', emailConfigured: Boolean(mailer) }));
  app.use(express.json({ limit: '1mb' }));
  const authLimit = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });
  for (const action of ['login', 'signup', 'refresh']) app.post(`/auth/${action}`, authLimit, async (req, res) => {
    if (!auth) return res.status(503).json({ error: '계정 로그인 서버가 아직 설정되지 않았습니다. 개인 테스트용 연결 암호를 사용해 주세요.' });
    const schema = action === 'refresh' ? z.object({ refresh_token: z.string().min(1).max(4096) }) : z.object({ email: z.email(), password: z.string().min(8).max(200) });
    const input = schema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: '이메일과 8자 이상의 비밀번호를 확인해 주세요.' });
    try { res.json(await auth[action](input.data)); }
    catch { res.status(400).json({ error: '로그인 정보를 확인해 주세요. 가입 시 받은 확인 이메일도 확인해 주세요.' }); }
  });
  app.use(async (req, res, next) => {
    if (auth) {
      try {
        req.user = await auth.verify((req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!req.user?.id || !req.user.email_confirmed_at) return res.status(401).json({ error: '이메일 인증 후 다시 로그인해 주세요.' });
        return next();
      } catch { return res.status(401).json({ error: '로그인이 만료됐습니다. 다시 로그인해 주세요.' }); }
    }
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (!token || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: '서버 연결 암호를 확인해 주세요.' });
    req.user = { id: 'development' };
    next();
  });
  app.use(rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
    handler: (_, res) => res.status(429).json({ error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }) }));
  app.use(rateLimit({ windowMs: 3_600_000, limit: 20, keyGenerator: req => req.user.id,
    handler: (_, res) => res.status(429).json({ error: '시간당 처리 한도에 도달했습니다. 잠시 후 시도해 주세요.' }) }));
  app.delete('/account', async (req, res) => {
    if (!auth?.remove) return res.status(503).json({ error: '계정 삭제 기능을 서버에 설정해야 합니다. 개발자에게 문의해 주세요.' });
    try { await auth.remove(req.user.id); await deliveries?.removeUser(req.user.id); res.json({ ok: true }); }
    catch { res.status(502).json({ error: '계정 삭제를 완료하지 못했습니다.' }); }
  });
  app.post('/send-email', async (req, res, next) => {
    try {
      if (!mailer || !deliveries) return res.status(503).json({ error: '메일 발송 서버가 아직 설정되지 않았습니다. 회의록은 앱에 저장되어 있습니다.' });
      const input = z.object({ id: z.string().min(1).max(120), recipients: z.array(z.email()).min(1).max(10), title: z.string().max(200), text: z.string().min(1).max(220_000) }).parse(req.body);
      const key = `${req.user.id}:${input.id}`;
      const existing = deliveries.get(key);
      if (existing?.state === 'sent') return res.json({ ok: true, deduplicated: true });
      if (existing) return res.status(409).json({ error: '이전 전송 결과를 확인 중이거나 결과가 불확실합니다. 수신함을 확인한 뒤 새 전송을 요청해 주세요.' });
      await deliveries.set(key, { state: 'pending', at: new Date().toISOString() });
      try {
        await mailer.send(input);
        await deliveries.set(key, { state: 'sent', at: new Date().toISOString() });
        res.json({ ok: true });
      } catch {
        await deliveries.set(key, { state: 'unknown', at: new Date().toISOString() });
        res.status(502).json({ error: '메일 전송 결과를 확인하지 못했습니다. 재전송 전 수신함을 확인해 주세요.' });
      }
    } catch (error) { next(error); }
  });
  app.post('/transcribe', async (req, res, next) => {
    if (!configured) return res.status(503).json({ error: '서버에 AI API 키를 설정해 주세요.' });
    let directory;
    try {
      directory = await mkdtemp(join(tmpdir(), 'meeting-notes-'));
      const upload = multer({ dest: directory, limits: { fileSize: maxBytes, files: 1, fields: 0 },
        fileFilter: (_, file, cb) => cb(null, /\.(m4a|mp3|mp4|wav|webm|ogg|flac)$/i.test(file.originalname)) }).single('audio');
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      if (!req.file) return res.status(400).json({ error: '지원하는 녹음 파일을 첨부해 주세요.' });
      if (!req.file.size) return res.status(400).json({ error: '녹음 파일이 비어 있습니다.' });
      const transcript = await gateway.transcribe(req.file);
      res.json({ transcript });
    } catch (error) { next(error); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  });
  app.post('/summarize', async (req, res, next) => {
    if (!configured) return res.status(503).json({ error: '서버에 AI API 키를 설정해 주세요.' });
    try {
      const { transcript, title } = z.object({ transcript: z.string().trim().min(1).max(180_000), title: z.string().max(200).default('회의') }).parse(req.body);
      const result = summarySchema.parse(await gateway.summarize(transcript, title));
      res.json({ result });
    } catch (error) { next(error); }
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '파일이 24MB를 넘습니다. 녹음을 나누어 주세요.' });
    if (error instanceof z.ZodError || error instanceof multer.MulterError || error.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식을 확인해 주세요.' });
    if (error.status === 401) return res.status(502).json({ error: '서버의 AI 인증 설정을 확인해 주세요.' });
    if (error.status === 429) return res.status(503).json({ error: 'AI 이용 한도 또는 잔액을 확인한 뒤 다시 시도해 주세요.' });
    res.status(502).json({ error: 'AI 처리를 완료하지 못했습니다. 녹음은 아이폰에 보관되어 있으니 다시 시도해 주세요.' });
  });
  return app;
}
