export type ActionItem = { task: string; owner: string | null; due: string | null; done?: boolean };
export type Summary = { title: string; summary: string; decisions: string[]; actions: ActionItem[]; openQuestions: string[] };
export type Meeting = {
  id: string; title: string; createdAt: string; duration: number; fileName?: string;
  transcript: string; notes: string; result?: Summary; interrupted?: boolean;
  emailStatus?: 'not-sent' | 'sending' | 'sent' | 'unknown'; emailedTo?: string[]; emailAttempt?: string; workflowError?: string;
};
export const durationLabel = (seconds: number) => {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
};
export function meetingText(m: Meeting) {
  const r = m.result;
  return [m.title, new Date(m.createdAt).toLocaleString('ko-KR'),
    r && `\n회의 요약\n${r.summary}`,
    r && `\n결정 사항\n${r.decisions.map(x => `• ${x}`).join('\n')}`,
    r && `\n할 일\n${r.actions.map(x => `${x.done ? '☑' : '☐'} ${x.task}${x.owner ? ` / ${x.owner}` : ''}${x.due ? ` / ${x.due}` : ''}`).join('\n')}`,
    r && `\n추가 확인\n${r.openQuestions.join('\n')}`,
    m.notes && `\n내 메모\n${m.notes}`, `\n받아쓰기\n${m.transcript || '(아직 없음)'}`].filter(Boolean).join('\n');
}
