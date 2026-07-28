/**
 * 报告生成的跨页面状态。
 *
 * 生成一份报告要几分钟，用户在等待期间切到别的页面是常态。React Router 会卸载
 * 报告页组件，组件内的 state 随之丢失——回来时看到空白，以为生成失败了。实际上
 * 那个 async 流程还在跑，只是没人接收它的输出。
 *
 * 把进行中的内容放在组件之外，卸载不受影响，重新挂载时直接接回去。
 */
export interface ReportGenerationStage {
  label: string;
  current?: number;
  total?: number;
  detail?: string;
}

export interface ReportGenerationSnapshot {
  active: boolean;
  projectId: string | null;
  content: string;
  stage: ReportGenerationStage | null;
  startedAt: number | null;
}

const EMPTY: ReportGenerationSnapshot = {
  active: false,
  projectId: null,
  content: "",
  stage: null,
  startedAt: null,
};

let snapshot: ReportGenerationSnapshot = { ...EMPTY };
const listeners = new Set<(value: ReportGenerationSnapshot) => void>();

const emit = () => {
  for (const listener of listeners) listener(snapshot);
};

export const getReportGeneration = () => snapshot;

export const subscribeReportGeneration = (
  listener: (value: ReportGenerationSnapshot) => void,
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const startReportGeneration = (projectId: string | null) => {
  snapshot = { active: true, projectId, content: "", stage: null, startedAt: Date.now() };
  emit();
};

export const updateReportGeneration = (patch: Partial<ReportGenerationSnapshot>) => {
  if (!snapshot.active) return;
  snapshot = { ...snapshot, ...patch };
  emit();
};

export const finishReportGeneration = () => {
  snapshot = { ...EMPTY };
  emit();
};
