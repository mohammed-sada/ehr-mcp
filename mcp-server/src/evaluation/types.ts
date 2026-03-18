export type EvalTaskType = "simple" | "multi" | "reasoning";

export interface EvalTask {
  id: number;
  question: string;
  subject_id: number;
  type: EvalTaskType;
  params?: Record<string, unknown>;
}

export interface GroundTruthRow {
  task_id: number;
  type: EvalTaskType;
  question: string;
  subject_id: number;
  expected_answer: unknown;
}

