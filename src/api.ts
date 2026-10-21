import { Platform } from 'react-native';
import { audioUri, getToken, refreshToken, saveSession } from './storage';
import type { Summary } from './types';

async function call(base: string, token: string, path: string, body: BodyInit, json = false) {
  const endpoint = base.trim().replace(/\/+$/, '');
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('올바른 서버 주소를 입력해 주세요.');
  if (!__DEV__ && url.protocol !== 'https:') throw new Error('보안 연결(HTTPS)이 필요합니다.');
  const headers: Record<string, string> = { Authorization: `Bearer ${await getToken() || token}` };
  if (json) headers['Content-Type'] = 'application/json';
  let response = await fetch(endpoint + path, { method: 'POST', headers, body, signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (response.status === 401) {
    const refresh = await refreshToken();
    if (refresh) {
      const renewed = await fetch(endpoint + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }), signal: AbortSignal.timeout(30000) });
      if (renewed.ok) {
        const session = await renewed.json();
        await saveSession(session.access_token, session.refresh_token);
        headers.Authorization = `Bearer ${session.access_token}`;
        response = await fetch(endpoint + path, { method: 'POST', headers, body, signal: AbortSignal.timeout(10 * 60 * 1000) });
      }
    }
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `서버 오류 (${response.status})`);
  return data;
}
export async function transcribe(base: string, token: string, name: string): Promise<string> {
  if (Platform.OS === 'web') throw new Error('녹음 받아쓰기는 아이폰에서 시험해 주세요.');
  const body = new FormData();
  const ext = name.split('.').pop()?.toLowerCase();
  body.append('audio', { uri: audioUri(name), name, type: ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4' } as any);
  return (await call(base, token, '/transcribe', body)).transcript;
}
export async function summarize(base: string, token: string, transcript: string, title: string): Promise<Summary> {
  return (await call(base, token, '/summarize', JSON.stringify({ transcript, title }), true)).result;
}
export async function sendEmail(base: string, token: string, id: string, recipients: string[], title: string, text: string) {
  return call(base, token, '/send-email', JSON.stringify({ id, recipients, title, text }), true);
}
