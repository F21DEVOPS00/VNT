import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Meeting } from './types';

const KEY = 'meeting-notes.v1';
export const audioRoot = () => `${FS.documentDirectory}meetings/`;
export const audioUri = (name: string) => audioRoot() + name;
export const loadMeetings = async (): Promise<Meeting[]> => JSON.parse(await AsyncStorage.getItem(KEY) || '[]');
export const saveMeetings = (meetings: Meeting[]) => AsyncStorage.setItem(KEY, JSON.stringify(meetings));
export async function saveAudio(uri: string, id: string) {
  if (Platform.OS === 'web') throw new Error('녹음 파일 저장은 아이폰 앱에서 사용해 주세요.');
  await FS.makeDirectoryAsync(audioRoot(), { intermediates: true });
  const ext = uri.split('.').pop()?.split('?')[0] || 'm4a';
  const name = `${id}.${ext}`;
  await FS.copyAsync({ from: uri, to: audioUri(name) });
  const saved = await FS.getInfoAsync(audioUri(name));
  if (!saved.exists || !saved.size) throw new Error('녹음 파일 저장을 확인하지 못했습니다. 원본을 보존했으니 앱을 다시 열어 복구해 주세요.');
  return name;
}
export async function removeAudio(name?: string) {
  if (name) await FS.deleteAsync(audioUri(name), { idempotent: true });
}
export async function setToken(token: string) {
  if (Platform.OS !== 'web') {
    if (token) await SecureStore.setItemAsync('meeting-access-token', token);
    else await SecureStore.deleteItemAsync('meeting-access-token');
  }
}
export async function getToken() {
  return Platform.OS === 'web' ? '' : await SecureStore.getItemAsync('meeting-access-token') || '';
}
export async function saveSession(access: string, refresh?: string) {
  await setToken(access);
  if (Platform.OS !== 'web' && refresh) await SecureStore.setItemAsync('meeting-refresh-token', refresh);
}
export async function refreshToken() {
  return Platform.OS === 'web' ? '' : await SecureStore.getItemAsync('meeting-refresh-token') || '';
}
export async function clearSession() {
  await setToken('');
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync('meeting-refresh-token');
}
export async function pendingRecording(value?: { uri: string; meeting: Meeting } | null) {
  if (value === undefined) return JSON.parse(await AsyncStorage.getItem('pending-recording') || 'null');
  if (value === null) await AsyncStorage.removeItem('pending-recording');
  else await AsyncStorage.setItem('pending-recording', JSON.stringify(value));
}
