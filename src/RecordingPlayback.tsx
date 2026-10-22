import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as FS from 'expo-file-system/legacy';
import { audioUri } from './storage';
import { durationLabel } from './types';

// One player per selected recording. Pause/resume must not replace its source.
export function RecordingPlayback({ fileName, disabled }: { fileName: string; disabled: boolean }) {
  const uri = audioUri(fileName);
  const player = useAudioPlayer({ uri }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  async function play(fromStart = false) {
    if (working || disabled) return;
    setWorking(true); setError('');
    try {
      if (!fromStart && player.playing) { player.pause(); return; }
      const file = await FS.getInfoAsync(uri);
      if (!file.exists || !file.size) throw new Error('저장된 녹음 파일이 없거나 비어 있습니다.');
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, playsInSilentMode: true, shouldPlayInBackground: false });
      if (!player.isLoaded) throw new Error('녹음 파일을 준비하고 있습니다. 잠시 후 다시 눌러 주세요.');
      if (fromStart || status.didJustFinish || (player.duration > 0 && player.currentTime >= player.duration - 0.1)) await player.seekTo(0);
      player.muted = false; player.volume = 1;
      player.play();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '녹음을 재생하지 못했습니다.'); }
    finally { setWorking(false); }
  }
  const buttonStyle = { padding: 14, borderWidth: 1, borderColor: '#E6E5DF', borderRadius: 11, backgroundColor: '#fff' };
  return <View style={{ marginTop: 20, gap: 10 }}>
    <Text style={{ color: '#17233C', fontWeight: '600' }}>원본 녹음</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: '#7A8190', fontSize: 12 }}>
      {status.playing ? '재생 중' : status.isLoaded ? '재생 준비 완료' : '녹음 파일 준비 중'} · {durationLabel(status.currentTime)} / {durationLabel(status.duration)}
    </Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Pressable accessibilityRole="button" disabled={disabled || working} onPress={() => play()} style={[buttonStyle, (disabled || working) && { opacity: 0.4 }]}><Text style={{ color: '#294D78' }}>{status.playing ? '일시정지' : status.currentTime > 0 && !status.didJustFinish ? '이어 듣기' : '녹음 듣기'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled || working} onPress={() => play(true)} style={buttonStyle}><Text style={{ color: '#294D78' }}>처음부터 다시 듣기</Text></Pressable>
    </View>
    {!!(error || status.error) && <Text accessibilityRole="alert" style={{ color: '#81591F', lineHeight: 20 }}>{error || status.error}</Text>}
  </View>;
}
