import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import nodemailer from 'nodemailer';

export function createAuth(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return undefined;
  const base = env.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1';
  if (!base.startsWith('https://')) throw new Error('Supabase requires HTTPS');
  async function request(path, method, body, token = env.SUPABASE_ANON_KEY, admin = false) {
    const key = admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
    const response = await fetch(base + path, { method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Authentication failed');
    return response.json();
  }
  const auth = {
    login: body => request('/token?grant_type=password', 'POST', body),
    signup: body => request('/signup', 'POST', body),
    refresh: body => request('/token?grant_type=refresh_token', 'POST', body),
    verify: token => request('/user', 'GET', undefined, token),
  };
  if (env.SUPABASE_SERVICE_ROLE_KEY) auth.remove = id => request(`/admin/users/${encodeURIComponent(id)}`, 'DELETE', undefined, env.SUPABASE_SERVICE_ROLE_KEY, true);
  return auth;
}
export function createMailer(env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.MAIL_FROM) return undefined;
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_PORT === '465', requireTLS: env.SMTP_PORT !== '465', auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } });
  return { send: ({ recipients, title, text }) => transport.sendMail({ from: env.MAIL_FROM, bcc: recipients,
    subject: `[VNT 회의록] ${title.replace(/[\r\n]/g, ' ')}`, text, disableFileAccess: true, disableUrlAccess: true }) };
}
export async function createDeliveryStore(path) {
  await mkdir(dirname(path), { recursive: true });
  let entries;
  try { entries = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = {}; }
  let queue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(entries);
    queue = queue.catch(() => {}).then(async () => { await writeFile(path + '.tmp', snapshot, { mode: 0o600 }); await rename(path + '.tmp', path); });
    return queue;
  };
  return { get: key => entries[key],
    set: async (key, value) => { entries[key] = value; await persist(); },
    removeUser: async id => { for (const key of Object.keys(entries)) if (key.startsWith(id + ':')) delete entries[key]; await persist(); } };
}
