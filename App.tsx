import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { isRunningInExpoGo } from 'expo';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { audioUri, getToken, loadMeetings, pendingRecording, removeAudio, saveAudio, saveMeetings, setToken, saveSession, clearSession } from './src/storage';
import { sendEmail, summarize, transcribe } from './src/api';
import { durationLabel, Meeting, meetingText } from './src/types';

const colors = { ink: '#17233C', muted: '#7A8190', background: '#F8F7F3', line: '#E6E5DF', red: '#EC4D45', blue: '#294D78' };
const dateLabel = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const errorText = (error: unknown) => error instanceof Error ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.';
type Settings = { base: string; recipients: string[]; automatic: boolean };
const defaultSettings: Settings = { base: process.env.EXPO_PUBLIC_API_URL || '', recipients: (process.env.EXPO_PUBLIC_DEFAULT_RECIPIENTS || '').split(',').map((x: string) => x.trim()).filter(Boolean), automatic: true };

function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.4 }]}><Text style={s.buttonText}>{label}</Text></Pressable>;
}
function AppBody() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const all = useRef<Meeting[]>([]);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const [token, updateToken] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Meeting | null>(null);
  const active = useRef<Meeting | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [stage, setStage] = useState('');
  const [banner, setBanner] = useState('');
  const [tab, setTab] = useState<'summary' | 'transcript' | 'notes'>('summary');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, sampleRate: 24000, bitRate: 48000, numberOfChannels: 1, directory: 'document', isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 250);
  const player = useAudioPlayer(null);
  const playerState = useAudioPlayerStatus(player);
  const selected = meetings.find(m => m.id === selectedId);

  async function commit(next: Meeting[]) {
    await saveMeetings(next);
    all.current = next;
    setMeetings(next);
  }
  async function upsert(meeting: Meeting) { await commit([meeting, ...all.current.filter(m => m.id !== meeting.id)]); }

  useEffect(() => {
    (async () => {
      try {
        let saved = await loadMeetings();
        const savedSettings = await AsyncStorage.getItem('meeting-settings');
        if (savedSettings) setSettings({ ...defaultSettings, ...JSON.parse(savedSettings) });
        updateToken(await getToken());
        if (Platform.OS !== 'web') {
          const pending = await pendingRecording();
          if (pending && !saved.some(m => m.id === pending.meeting.id)) {
            const info = await FS.getInfoAsync(pending.uri);
            if (info.exists && info.size > 0) {
              const name = await saveAudio(pending.uri, pending.meeting.id);
              saved = [{ ...pending.meeting, fileName: name, interrupted: true }, ...saved];
              await saveMeetings(saved);
              await FS.deleteAsync(pending.uri, { idempotent: true });
              setBanner('중단된 녹음 파일을 복구했습니다. 재생해 확인해 주세요.');
            }
          }
          await pendingRecording(null);
        }
        all.current = saved;
        setMeetings(saved);
      } catch (error) { setBanner('저장 목록을 읽지 못했습니다. ' + errorText(error)); }
      finally { setReady(true); }
    })();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && active.current && !recorder.isRecording && !lock.current) {
        setBanner('녹음이 일시정지되었거나 중단되었습니다. 빨간 버튼을 눌러 저장해 주세요.');
      }
    });
    return () => subscription.remove();
  }, [recorder]);

  async function runWorkflow(meeting: Meeting, autoEmail = settings.automatic) {
    let updated: Meeting = { ...meeting, workflowError: undefined };
    const alreadySent = updated.emailStatus === 'sent';
    try {
      if (!settings.base || !token) throw new Error('녹음은 저장됐습니다. 설정에서 AI 서버와 로그인을 연결해 주세요.');
      if (!updated.transcript) {
        if (!updated.fileName) throw new Error('받아쓸 녹음 파일이 없습니다.');
        setStage('음성을 텍스트로 바꾸고 있어요');
        updated.transcript = await transcribe(settings.base, token, updated.fileName);
        await upsert(updated);
      }
      if (!updated.result) {
        setStage('요약과 할 일을 정리하고 있어요');
        updated.result = await summarize(settings.base, token, updated.transcript, updated.title);
        updated.title = updated.result.title || updated.title;
        await upsert(updated);
      }
      if (autoEmail && settings.recipients.length && !alreadySent) {
        if (updated.emailStatus === 'unknown' || updated.emailStatus === 'sending') throw new Error('이전 메일의 전송 결과가 불확실합니다. 수신함을 확인한 뒤 수동 재전송해 주세요.');
        setStage('회의록을 이메일로 보내고 있어요');
        updated.emailStatus = 'sending';
        updated.emailAttempt = updated.emailAttempt || `${updated.id}-${Date.now()}`;
        await upsert(updated);
        try {
          await sendEmail(settings.base, token, updated.emailAttempt, settings.recipients, updated.title, meetingText(updated));
          updated.emailStatus = 'sent';
          updated.emailedTo = [...settings.recipients];
        } catch (error) { updated.emailStatus = 'unknown'; throw error; }
        await upsert(updated);
      }
      setBanner(updated.emailStatus === 'sent' ? '회의록 저장과 이메일 전송이 완료됐어요.' : autoEmail && !settings.recipients.length ? '회의록이 저장됐어요. 이메일을 보내려면 설정에서 수신자를 추가하세요.' : '회의록이 저장됐어요.');
    } catch (error) {
      updated.workflowError = errorText(error);
      await upsert(updated);
      setBanner(updated.workflowError);
    } finally { setStage(''); }
  }
  async function recordButton() {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setBanner('');
    try {
      if (active.current) {
        const captured = active.current;
        const seconds = recorder.currentTime || state.durationMillis / 1000;
        await recorder.stop();
        const uri = recorder.uri || state.url;
        if (!uri) throw new Error('녹음 파일을 찾지 못했습니다. 앱을 다시 열면 복구를 시도합니다.');
        const fileName = await saveAudio(uri, captured.id);
        const meeting = { ...captured, duration: seconds, fileName };
        await upsert(meeting);
        await pendingRecording(null);
        await FS.deleteAsync(uri, { idempotent: true });
        active.current = null; setCurrent(null);
        setSelectedId(meeting.id); setTab('summary');
        await runWorkflow(meeting);
      } else {
        if (Platform.OS === 'web') throw new Error('이 화면은 미리보기입니다. 실제 녹음은 아이폰 Expo Go에서 시작해 주세요.');
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error('아이폰 설정에서 마이크 사용을 허용해 주세요.');
        player.pause();
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: !isRunningInExpoGo() });
        await recorder.prepareToRecordAsync();
        const meeting: Meeting = { id: `${Date.now()}`, title: `${new Date().toLocaleDateString('ko-KR')} 회의`, createdAt: new Date().toISOString(), duration: 0, transcript: '', notes: '', emailStatus: 'not-sent' };
        if (!recorder.uri) throw new Error('녹음 저장 위치를 준비하지 못했습니다.');
        await pendingRecording({ uri: recorder.uri, meeting });
        recorder.record();
        active.current = meeting; setCurrent(meeting);
      }
    } catch (error) { setBanner(errorText(error)); }
    finally { setBusy(false); lock.current = false; }
  }
  async function guarded(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); } catch (error) { setBanner(errorText(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function storeSettings() {
    const nextRecipients = [...new Set([...settings.recipients, ...recipientInput.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)])];
    if (nextRecipients.length > 10 || nextRecipients.some(x => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) throw new Error('올바른 이메일 주소를 최대 10개 입력해 주세요.');
    if (settings.base) { const parsed = new URL(settings.base); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('서버 주소를 확인해 주세요.'); }
    const next = { ...settings, recipients: nextRecipients };
    await AsyncStorage.setItem('meeting-settings', JSON.stringify(next));
    await setToken(token); setSettings(next); setRecipientInput(''); setShowSettings(false);
  }
  async function authenticate(signup = false) {
    if (!settings.base) throw new Error('먼저 서버 주소를 입력해 주세요.');
    if (!__DEV__ && !settings.base.startsWith('https://')) throw new Error('보안 연결(HTTPS)이 필요합니다.');
    const response = await fetch(settings.base.replace(/\/+$/, '') + (signup ? '/auth/signup' : '/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authEmail, password: authPassword }), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '로그인하지 못했습니다.');
    if (result.access_token) { updateToken(result.access_token); await saveSession(result.access_token, result.refresh_token); }
    setAuthPassword(''); setAuthStatus(result.access_token ? '로그인됐습니다. 설정을 저장해 주세요.' : '가입 확인 이메일을 확인한 뒤 로그인해 주세요.');
  }
  function demo() {
    const m: Meeting = { id: `demo-${Date.now()}`, title: '이번 주 매장 운영 회의 · 샘플', createdAt: new Date().toISOString(), duration: 824, transcript: '민수: 이번 주 토요일 오픈 전에 메뉴 사진을 교체합시다.\n지연: 제가 사진을 정리해서 금요일까지 전달하겠습니다.\n민수: 좋습니다. 새로운 근무표는 아직 확정하지 말고 다음 회의에서 논의해요.', notes: '', result: { title: '이번 주 매장 운영 회의 · 샘플', summary: '토요일 오픈 전 메뉴 사진을 교체하기로 했습니다. 새로운 근무표는 다음 회의에서 논의합니다.', decisions: ['토요일 오픈 전 메뉴 사진 교체'], actions: [{ task: '메뉴 사진 정리 및 전달', owner: '지연', due: '금요일' }], openQuestions: ['새로운 근무표 확정'] } };
    guarded(async () => { await upsert(m); setSelectedId(m.id); setTab('summary'); });
  }

  return <SafeAreaView style={s.safe}><StatusBar style="dark" /><View style={s.top}><View><Text style={s.brand}>VNT<Text style={{ color: colors.red }}> ●</Text></Text><Text style={s.eyebrow}>VOICE NOTE TAKER</Text></View><Pressable accessibilityRole="button" accessibilityLabel="설정" onPress={() => setShowSettings(true)} disabled={busy || !!current} style={s.settings}><Text style={s.settingsLabel}>설정</Text></Pressable></View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.hero}><Text style={s.kicker}>{current ? 'RECORDING' : 'LESS TYPING. MORE LISTENING.'}</Text><Text style={s.heading}>{current ? '지금은, 대화에 집중하세요.' : '회의는 듣고,\n기록은 맡기세요.'}</Text><Text style={s.subheading}>{current ? '다시 누르면 녹음을 끝내고 회의록을 만들어요.' : '한 번 눌러 녹음하고, 한 번 눌러 마무리.'}</Text>
        <View style={s.recordArea}><View style={[s.recordHalo, current && { backgroundColor: '#FFE9E5' }]}><Pressable accessibilityRole="button" accessibilityLabel={current ? '녹음 종료 및 회의록 만들기' : '회의 녹음 시작'} accessibilityState={{ disabled: busy || !ready }} disabled={busy || !ready} onPress={recordButton} style={[s.recordButton, busy && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color="#fff" size="large" /> : current ? <View style={s.stopIcon} /> : <View style={s.smallMic}><View style={s.micBody} /><View style={s.micFoot} /></View>}</Pressable></View></View>
        <Text style={s.timer}>{current ? durationLabel(state.durationMillis / 1000) : busy ? '처리 중' : '녹음 시작'}</Text>
        {current && <Button label={state.isRecording ? '잠시 멈추기' : '녹음 계속하기'} onPress={() => { state.isRecording ? recorder.pause() : recorder.record(); }} disabled={busy} />}
        {!!stage && <Text accessibilityLiveRegion="polite" style={s.stage}>{stage}</Text>}
        <View style={s.workflow}><Text style={s.workflowText}>녹음  →  텍스트  →  회의록  →  이메일</Text></View>
        <Text style={s.consent}>{settings.recipients.length ? `수신: ${settings.recipients.join(', ')}` : '설정에서 회의록을 받을 이메일을 추가하세요.'}</Text>
        <Text style={s.privacy}>{settings.automatic ? '녹음 종료 후 AI 서버에 전송하고 이메일로 보냅니다.' : '자동 이메일 전송이 꺼져 있습니다. AI 처리 후 앱에 저장합니다.'}{'\n'}참석자에게 녹음 사실을 알리고 동의를 받아 주세요.</Text>
      </View>
      {!!banner && <View style={s.notice}><Text selectable style={s.noticeText}>{banner}</Text></View>}
      <View style={s.sectionRow}><Text style={s.sectionTitle}>내 회의록</Text><Text style={s.count}>{meetings.length}개</Text></View>
      {meetings.length === 0 ? <View style={s.empty}><Text style={s.emptyTitle}>첫 번째 회의를 담아보세요.</Text><Text style={s.emptyText}>녹음 파일과 회의록이 여기에 차곡차곡 쌓여요.</Text><Button label="샘플 회의록 보기" onPress={demo} disabled={!ready || busy} /></View> : meetings.map(m => <Pressable key={m.id} disabled={busy || !!current} onPress={() => { player.pause(); setSelectedId(m.id); setTab('summary'); }} style={s.card}><View style={s.cardIcon}><Text style={{ color: colors.blue, fontSize: 22 }}>≋</Text></View><View style={{ flex: 1 }}><Text numberOfLines={1} style={s.cardTitle}>{m.title}</Text><Text style={s.cardMeta}>{dateLabel(m.createdAt)} · {durationLabel(m.duration)}</Text></View><Text style={[s.badge, { color: m.emailStatus === 'sent' ? '#39725B' : colors.muted }]}>{m.emailStatus === 'sent' ? '발송 완료' : m.result ? '회의록' : '녹음'}</Text></Pressable>)}
      <Text style={s.footer}>작은 버튼 하나로, 대화가 기록이 됩니다.</Text>
    </ScrollView>

    <Modal visible={!!selected && !current} animationType="slide" onRequestClose={() => { if (!busy) { player.pause(); setSelectedId(null); } }}><SafeAreaView style={s.safe}><View style={s.modalTop}><Button label="닫기" disabled={busy} onPress={() => { player.pause(); setSelectedId(null); }} /><Text style={s.eyebrow}>MEETING NOTES</Text><Button label="공유" disabled={busy} onPress={() => selected && guarded(async () => { await Share.share({ message: meetingText(selected) }); })} /></View>{selected && <ScrollView contentContainerStyle={s.detail} keyboardShouldPersistTaps="handled"><TextInput accessibilityLabel="회의 제목" style={s.detailHeading} value={selected.title} maxLength={200} editable={!busy} onChangeText={title => { const next = all.current.map(m => m.id === selected.id ? { ...m, title } : m); all.current = next; setMeetings(next); }} onBlur={() => guarded(() => saveMeetings(all.current))} /><Text style={s.cardMeta}>{dateLabel(selected.createdAt)} · {durationLabel(selected.duration)}{selected.interrupted ? ' · 중단 후 복구' : ''}</Text>
        {selected.fileName && <View style={s.actions}><Button label={playerState.playing ? '재생 멈추기' : '녹음 듣기'} disabled={busy} onPress={() => guarded(async () => { if (playerState.playing) player.pause(); else { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); player.replace(audioUri(selected.fileName!)); player.play(); } })} /><Button label="녹음 내보내기" disabled={busy} onPress={() => guarded(async () => { if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(audioUri(selected.fileName!)); else throw new Error('이 기기에서 파일 공유를 지원하지 않습니다.'); })} /></View>}
        <View style={s.tabs}>{(['summary', 'transcript', 'notes'] as const).map((key, i) => <Pressable key={key} onPress={() => setTab(key)} style={[s.tab, tab === key && s.activeTab]}><Text style={[s.tabText, tab === key && { color: colors.ink }]}>{['회의록', '받아쓰기', '내 메모'][i]}</Text></Pressable>)}</View>
        {tab === 'summary' && (selected.result ? <><Text style={s.detailBody}>{selected.result.summary}</Text><Text style={s.detailLabel}>결정 사항</Text>{selected.result.decisions.map((text, i) => <Text key={i} style={s.bullet}>• {text}</Text>)}<Text style={s.detailLabel}>할 일</Text>{selected.result.actions.map((a, i) => <Pressable key={i} disabled={busy} onPress={() => guarded(async () => { const updated = { ...selected, result: { ...selected.result!, actions: selected.result!.actions.map((x, n) => n === i ? { ...x, done: !x.done } : x) } }; await upsert(updated); })} style={s.task}><Text style={s.taskBox}>{a.done ? '☑' : '☐'}</Text><View style={{ flex: 1 }}><Text style={[s.taskTitle, a.done && { textDecorationLine: 'line-through', opacity: 0.5 }]}>{a.task}</Text><Text style={s.cardMeta}>{a.owner || '담당자 미정'} · {a.due || '기한 미정'}</Text></View></Pressable>)}<Text style={s.detailLabel}>추가 확인</Text>{selected.result.openQuestions.map((q, i) => <Text key={i} style={s.bullet}>• {q}</Text>)}<Text style={s.privacy}>AI 결과는 원문과 비교해 확인해 주세요.</Text></> : <View style={s.empty}><Text style={s.emptyTitle}>녹음이 안전하게 저장됐어요.</Text><Text style={s.emptyText}>AI 연결 후 받아쓰기와 회의록을 만들 수 있어요.</Text></View>)}
        {tab === 'transcript' && <Text selectable style={s.detailBody}>{selected.transcript || '아직 받아쓰기가 없습니다.'}</Text>}
        {tab === 'notes' && <TextInput accessibilityLabel="내 메모" multiline placeholder="회의 중 떠오른 생각을 적어보세요." value={selected.notes} editable={!busy} style={s.notesInput} onChangeText={notes => { const next = all.current.map(m => m.id === selected.id ? { ...m, notes } : m); all.current = next; setMeetings(next); }} onBlur={() => guarded(() => saveMeetings(all.current))} />}
        {!!stage && <Text style={s.stage}>{stage}</Text>}{!!selected.workflowError && <Text selectable style={s.noticeText}>{selected.workflowError}</Text>}
        <View style={s.actions}><Button label={selected.result ? '이메일 보내기' : 'AI 회의록 만들기'} disabled={busy || !ready} onPress={() => {
          if (selected.result && (selected.emailStatus === 'sent' || selected.emailStatus === 'unknown' || selected.emailStatus === 'sending')) {
            Alert.alert('회의록 재전송', '수신함을 먼저 확인해 주세요. 다시 보내면 중복 메일이 도착할 수 있습니다.', [{ text: '취소', style: 'cancel' }, { text: '다시 보내기', onPress: () => guarded(() => runWorkflow({ ...selected, emailStatus: 'not-sent', emailAttempt: undefined }, true)) }]);
          } else guarded(() => runWorkflow(selected, true));
        }} /><Button label="삭제" disabled={busy} onPress={() => Alert.alert('회의 삭제', '녹음과 회의록을 이 기기에서 삭제합니다.', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => guarded(async () => { player.pause(); await removeAudio(selected.fileName); await commit(all.current.filter(m => m.id !== selected.id)); setSelectedId(null); }) }])} /></View>
      </ScrollView>}</SafeAreaView></Modal>

    <Modal visible={showSettings} animationType="slide" onRequestClose={() => { if (!busy) setShowSettings(false); }}><SafeAreaView style={s.safe}><View style={s.modalTop}><Text style={s.sectionTitle}>설정</Text><Button label="저장" disabled={busy} onPress={() => guarded(storeSettings)} /></View><ScrollView contentContainerStyle={s.detail} keyboardShouldPersistTaps="handled"><Text style={s.detailLabel}>회의록 받을 이메일</Text><Text style={s.emptyText}>여러 명에게 동시에 보낼 수 있어요. 최대 10명.</Text>{settings.recipients.map(email => <View style={s.recipient} key={email}><Text style={{ flex: 1, color: colors.ink }}>{email}</Text><Button label="제거" onPress={() => setSettings({ ...settings, recipients: settings.recipients.filter(x => x !== email) })} /></View>)}<TextInput accessibilityLabel="이메일 추가" placeholder="이메일 입력 · 쉼표로 여러 개 추가" keyboardType="email-address" autoCapitalize="none" value={recipientInput} onChangeText={setRecipientInput} style={s.input} /><View style={s.switchRow}><View style={{ flex: 1 }}><Text style={s.taskTitle}>녹음 종료 후 자동 이메일</Text><Text style={s.cardMeta}>AI 회의록이 완성되면 발송해요.</Text></View><Switch value={settings.automatic} onValueChange={automatic => setSettings({ ...settings, automatic })} trackColor={{ true: colors.red }} /></View>
        <Text style={s.detailLabel}>AI 연결</Text><Text style={s.emptyText}>AI 받아쓰기와 요약에는 API 사용료가 발생할 수 있어요. 녹음은 먼저 아이폰에 저장됩니다.</Text>{__DEV__ && <TextInput accessibilityLabel="서버 주소" placeholder="https://your-meeting-server.example" autoCapitalize="none" autoCorrect={false} value={settings.base} onChangeText={base => setSettings({ ...settings, base })} style={s.input} />}
        <Text style={s.detailLabel}>계정</Text><TextInput accessibilityLabel="로그인 이메일" value={authEmail} onChangeText={setAuthEmail} autoCapitalize="none" keyboardType="email-address" placeholder="이메일" style={s.input} /><TextInput accessibilityLabel="비밀번호" value={authPassword} onChangeText={setAuthPassword} secureTextEntry placeholder="비밀번호 · 8자 이상" style={s.input} /><View style={s.actions}><Button label="로그인" disabled={busy} onPress={() => guarded(() => authenticate())} /><Button label="회원가입" disabled={busy} onPress={() => guarded(() => authenticate(true))} /></View>{!!authStatus && <Text style={s.stage}>{authStatus}</Text>}
        {__DEV__ && <><Text style={s.detailLabel}>개인 개발 테스트용 연결 암호</Text><Text style={s.emptyText}>서버에서 개인 테스트 모드를 사용할 때만 입력합니다. OpenAI API 키는 여기에 넣지 마세요.</Text><TextInput accessibilityLabel="연결 암호" secureTextEntry value={token} onChangeText={updateToken} autoCapitalize="none" autoCorrect={false} placeholder="연결 암호" style={s.input} /></>}<View style={s.actions}><Button label="연결 해제" onPress={() => guarded(async () => { updateToken(''); await clearSession(); setAuthStatus('연결을 해제했습니다.'); })} /><Button label="계정 삭제" disabled={busy || !token} onPress={() => Alert.alert('계정과 기록 삭제', '계정을 삭제하고 이 아이폰의 모든 녹음과 회의록을 지웁니다. 이미 보낸 이메일은 회수할 수 없습니다.', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => guarded(async () => { const response = await fetch(settings.base.replace(/\/+$/, '') + '/account', { method: 'DELETE', headers: { Authorization: `Bearer ${await getToken() || token}` } }); if (!response.ok) { const data = await response.json(); throw new Error(data.error || '계정을 삭제하지 못했습니다.'); } for (const m of all.current) await removeAudio(m.fileName); await commit([]); await clearSession(); updateToken(''); setAuthStatus('계정과 기기 기록을 삭제했습니다.'); }) }])} /></View>
        <Text style={s.detailLabel}>파일에서 가져오기</Text><Button label="기존 녹음 파일 가져오기" disabled={busy || Platform.OS === 'web'} onPress={() => guarded(async () => { const picked = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true }); if (picked.canceled) return; const file = picked.assets[0]; if (file.size && file.size > 24 * 1024 * 1024) throw new Error('24MB 이하의 녹음 파일을 선택해 주세요.'); const id = `${Date.now()}`; const fileName = await saveAudio(file.uri, id); await upsert({ id, title: file.name, fileName, createdAt: new Date().toISOString(), duration: 0, transcript: '', notes: '' }); setShowSettings(false); setBanner('녹음 파일을 가져왔습니다. 회의록을 열어 AI 분석을 시작하세요.'); })} />
        {!!banner && <Text style={s.noticeText}>{banner}</Text>}<Text style={s.privacy}>외부 AI 분석 시 녹음과 텍스트가 설정된 서버 및 AI 제공자에게 전송됩니다. 이메일 수신자는 회의록 전체를 받습니다. 배경 녹음은 독립 앱 빌드 후 실제 아이폰에서 검증해야 합니다.</Text><Button label="닫기" disabled={busy} onPress={() => setShowSettings(false)} />
      </ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><AppBody /></SafeAreaProvider>; }
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingVertical: 16 }, brand: { fontSize: 29, fontWeight: '900', letterSpacing: -1, color: colors.ink }, eyebrow: { fontSize: 9, color: colors.muted, letterSpacing: 2, marginTop: 3 }, settings: { borderWidth: 1, borderColor: colors.line, borderRadius: 30, paddingHorizontal: 16, paddingVertical: 10 }, settingsLabel: { fontSize: 13, color: colors.ink }, content: { paddingHorizontal: 26, paddingBottom: 30, width: '100%', maxWidth: 680, alignSelf: 'center' }, hero: { alignItems: 'center', paddingTop: 32, paddingBottom: 26 }, kicker: { fontSize: 9, letterSpacing: 2, color: colors.muted, marginBottom: 20 }, heading: { fontSize: 32, fontWeight: '700', lineHeight: 44, letterSpacing: -1.5, textAlign: 'center', color: colors.ink }, subheading: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 21 }, recordArea: { paddingVertical: 29 }, recordHalo: { width: 164, height: 164, borderRadius: 82, backgroundColor: '#F1EDE8', alignItems: 'center', justifyContent: 'center' }, recordButton: { width: 126, height: 126, borderRadius: 63, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 12px 28px rgba(236,77,69,0.20)' }, smallMic: { alignItems: 'center' }, micBody: { width: 18, height: 30, borderRadius: 10, borderWidth: 2.5, borderColor: '#fff' }, micFoot: { width: 28, height: 14, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderColor: '#fff', marginTop: -9 }, stopIcon: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#fff' }, timer: { color: colors.ink, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] }, workflow: { marginTop: 28, borderTopWidth: 1, borderColor: colors.line, paddingTop: 20, width: '100%', alignItems: 'center' }, workflowText: { fontSize: 12, letterSpacing: 0.5, color: colors.blue }, consent: { fontSize: 11, color: colors.ink, marginTop: 15, textAlign: 'center', lineHeight: 18 }, privacy: { color: colors.muted, fontSize: 10, lineHeight: 17, marginTop: 12, textAlign: 'left' }, sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 18 }, sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' }, count: { fontSize: 12, color: colors.muted }, empty: { paddingVertical: 28, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 18, alignItems: 'center', marginTop: 5 }, emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' }, emptyText: { color: colors.muted, fontSize: 12, lineHeight: 20, marginVertical: 10 }, button: { paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 11, alignSelf: 'flex-start', backgroundColor: '#fff' }, buttonText: { color: colors.blue, fontSize: 12, fontWeight: '600' }, card: { padding: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }, cardIcon: { width: 42, height: 46, borderRadius: 12, backgroundColor: '#EFF2F4', justifyContent: 'center', alignItems: 'center' }, cardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink }, cardMeta: { color: colors.muted, fontSize: 11, marginTop: 6, lineHeight: 17 }, badge: { fontSize: 10 }, notice: { borderRadius: 12, backgroundColor: '#FFF0DA', padding: 14, marginBottom: 12 }, noticeText: { color: '#81591F', fontSize: 12, lineHeight: 20 }, footer: { textAlign: 'center', color: colors.muted, fontSize: 10, marginTop: 32 }, modalTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 15, borderBottomWidth: 1, borderColor: colors.line }, detail: { padding: 24, paddingBottom: 60, maxWidth: 700, width: '100%', alignSelf: 'center' }, detailHeading: { color: colors.ink, fontSize: 26, fontWeight: '700', lineHeight: 36 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 20 }, tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line, marginVertical: 14 }, tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' }, activeTab: { borderBottomColor: colors.red }, tabText: { fontSize: 13, color: colors.muted, fontWeight: '600' }, detailBody: { color: colors.ink, fontSize: 15, lineHeight: 27, marginTop: 12 }, detailLabel: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 28, marginBottom: 12 }, bullet: { color: colors.ink, fontSize: 13, lineHeight: 24, marginBottom: 5 }, task: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line }, taskBox: { color: colors.red, fontSize: 23 }, taskTitle: { fontSize: 13, color: colors.ink, lineHeight: 21 }, notesInput: { minHeight: 220, color: colors.ink, fontSize: 15, lineHeight: 26, textAlignVertical: 'top', paddingVertical: 16 }, stage: { color: colors.blue, fontSize: 12, marginVertical: 14, lineHeight: 20 }, input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, backgroundColor: '#fff', color: colors.ink, fontSize: 13, marginVertical: 6 }, switchRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginVertical: 24 }, recipient: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 5 },
});
