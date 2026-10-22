import type { Summary } from './types';

// UI examples only: never assign these to a real recording's transcript/result.
export const sampleTranscript = '민수: 이번 주 토요일 오픈 전에 메뉴 사진을 교체합시다.\n지연: 제가 사진을 정리해서 금요일까지 전달하겠습니다.\n민수: 좋습니다. 새로운 근무표는 아직 확정하지 말고 다음 회의에서 논의해요.';
export const sampleSummary: Summary = {
  title: '이번 주 매장 운영 회의 · 샘플',
  summary: '토요일 오픈 전 메뉴 사진을 교체하기로 했습니다. 새로운 근무표는 다음 회의에서 논의합니다.',
  decisions: ['토요일 오픈 전 메뉴 사진 교체'],
  actions: [{ task: '메뉴 사진 정리 및 전달', owner: '지연', due: '금요일' }],
  openQuestions: ['새로운 근무표 확정'],
};
