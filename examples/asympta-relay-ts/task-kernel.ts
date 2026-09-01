export type TaskStatus =
  | "UNDERSTANDING"
  | "BLOCKED"
  | "READY"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "UNKNOWN"
  | "RECONCILING"
  | "VERIFYING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED_SAFE";

export type RequirementSource = "intent" | "policy" | "human";
export type Requirement = {
  id: string;
  semantic: string;
  question: string;
  required: boolean;
  value?: string;
  source?: RequirementSource;
  locked?: boolean;
};

export type CommitmentKind =
  | "create_identity"
  | "grant_access"
  | "schedule_expiry"
  | "notify"
  | "revoke_access"
  | "preserve_records";

export type CommitmentState =
  | "PLANNED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "UNKNOWN"
  | "RECONCILING"
  | "VERIFIED"
  | "FAILED_SAFE";

export type Evidence = {
  source: "browser" | "sandbox" | "policy" | "human";
  observedAt: string;
  summary: string;
  data?: Record<string, unknown>;
};

export type Commitment = {
  id: string;
  kind: CommitmentKind;
  label: string;
  requiresApproval: boolean;
  state: CommitmentState;
  idempotencyKey: string;
  expected: Record<string, unknown>;
  evidence: Evidence[];
};

export type TaskEvent = {
  revision: number;
  at: string;
  type: string;
  summary: string;
};

export type TaskState = {
  version: "asympta.task/solari-0.1";
  id: string;
  rootIntent: string;
  revision: number;
  status: TaskStatus;
  requirements: Requirement[];
  commitments: Commitment[];
  approvals: string[];
  processedCommandIds: string[];
  events: TaskEvent[];
};

export type Scenario = "contractor" | "offboard";

function now() {
  return new Date().toISOString();
}

function stableId(prefix: string, seed: string) {
  let hash = 2166136261;
  for (const ch of seed) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function parseDurationDays(intent: string) {
  const numeric = intent.match(/\b(\d+)\s+days?\b/i);
  if (numeric) return Number(numeric[1]);
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const word = intent.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/i);
  return word ? words[word[1].toLowerCase()] : undefined;
}

function parseProject(intent: string) {
  const match = intent.match(/\bProject\s+([A-Za-z][A-Za-z0-9_-]*)\b/i);
  return match?.[1] ? `Project ${match[1]}` : undefined;
}

function event(task: TaskState, type: string, summary: string) {
  task.events.push({ revision: task.revision, at: now(), type, summary });
}

function requirement(
  semantic: string,
  question: string,
  value?: string,
  source?: RequirementSource,
): Requirement {
  return {
    id: stableId("req", semantic),
    semantic,
    question,
    required: true,
    ...(value ? { value, source } : {}),
  };
}

function commitment(task: TaskState, kind: CommitmentKind, label: string, expected: Record<string, unknown>, requiresApproval = false): Commitment {
  const id = stableId("commit", `${task.id}:${kind}:${label}`);
  return {
    id,
    kind,
    label,
    requiresApproval,
    state: requiresApproval ? "AWAITING_APPROVAL" : "PLANNED",
    idempotencyKey: stableId("idem", id),
    expected,
    evidence: [],
  };
}

export function createTask(rootIntent: string, scenario: Scenario = "contractor"): TaskState {
  const project = parseProject(rootIntent);
  const durationDays = parseDurationDays(rootIntent);
  const task: TaskState = {
    version: "asympta.task/solari-0.1",
    id: stableId("task", rootIntent),
    rootIntent,
    revision: 1,
    status: "UNDERSTANDING",
    requirements: [],
    commitments: [],
    approvals: [],
    processedCommandIds: [],
    events: [],
  };

  if (scenario === "contractor") {
    task.requirements = [
      requirement("subject_email", "What email address should be used for the contractor?"),
      requirement("project", "Which project should the contractor access?", project, project ? "intent" : undefined),
      requirement("duration_days", "How long should the access remain active?", durationDays ? String(durationDays) : undefined, durationDays ? "intent" : undefined),
      requirement("least_privilege", "Should access be limited to only the named project?", /only\s+the\s+access\s+necessary|least\s+privilege/i.test(rootIntent) ? "yes" : undefined, /only\s+the\s+access\s+necessary|least\s+privilege/i.test(rootIntent) ? "intent" : undefined),
    ];
  } else {
    task.requirements = [
      requirement("subject_email", "Which user's access should be removed?"),
      requirement("project", "Which project access should be removed?", project, project ? "intent" : undefined),
      requirement("preserve_records", "Should existing records be preserved?", /preserve|do not lose|don't lose|keep/i.test(rootIntent) ? "yes" : undefined, /preserve|do not lose|don't lose|keep/i.test(rootIntent) ? "intent" : undefined),
    ];
  }

  task.status = nextBlockingRequirement(task) ? "BLOCKED" : "READY";
  event(task, "task.created", `Created durable task for: ${rootIntent}`);
  return task;
}

export function nextBlockingRequirement(task: TaskState) {
  return task.requirements.find((item) => item.required && !item.value);
}

export function answerRequirement(
  task: TaskState,
  input: { commandId: string; requirementId: string; expectedRevision: number; value: string },
) {
  if (task.processedCommandIds.includes(input.commandId)) return task;
  if (input.expectedRevision !== task.revision) {
    throw new Error(`stale revision: expected ${task.revision}, got ${input.expectedRevision}`);
  }
  const target = task.requirements.find((item) => item.id === input.requirementId);
  if (!target) throw new Error(`unknown requirement ${input.requirementId}`);
  if (target.locked && target.value !== input.value) throw new Error(`human-locked requirement ${target.semantic}`);

  target.value = input.value.trim();
  target.source = "human";
  target.locked = true;
  task.processedCommandIds.push(input.commandId);
  task.revision += 1;
  task.status = nextBlockingRequirement(task) ? "BLOCKED" : "READY";
  event(task, "requirement.answered", `${target.semantic} resolved by human`);
  return task;
}

function value(task: TaskState, semantic: string) {
  return task.requirements.find((item) => item.semantic === semantic)?.value;
}

export function planTask(task: TaskState, scenario: Scenario = "contractor") {
  const blocked = nextBlockingRequirement(task);
  if (blocked) throw new Error(`cannot plan while ${blocked.semantic} is unresolved`);
  if (task.commitments.length) return task;

  const email = value(task, "subject_email")!;
  const project = value(task, "project")!;

  if (scenario === "contractor") {
    const durationDays = Number(value(task, "duration_days"));
    const expiresAt = new Date(Date.now() + durationDays * 86_400_000).toISOString();
    task.commitments = [
      commitment(task, "create_identity", `Create identity for ${email}`, { email, exists: true }),
      commitment(task, "grant_access", `Grant least-privilege ${project} access`, { email, project, active: true }, true),
      commitment(task, "schedule_expiry", `Expire ${project} access automatically`, { email, project, expiresAt }),
      commitment(task, "notify", "Notify the project lead", { email, project, notified: true }),
    ];
  } else {
    task.commitments = [
      commitment(task, "revoke_access", `Revoke ${project} access for ${email}`, { email, project, active: false }, true),
      commitment(task, "preserve_records", `Preserve records for ${email}`, { email, preserved: true }),
      commitment(task, "notify", "Notify the project lead", { email, project, notified: true }),
    ];
  }

  task.revision += 1;
  task.status = task.commitments.some((item) => item.requiresApproval) ? "AWAITING_APPROVAL" : "READY";
  event(task, "task.planned", `${task.commitments.length} commitments created`);
  return task;
}

export function approveCommitment(task: TaskState, commitmentId: string, approvalId: string) {
  const item = task.commitments.find((candidate) => candidate.id === commitmentId);
  if (!item) throw new Error(`unknown commitment ${commitmentId}`);
  if (!item.requiresApproval) return task;
  if (!task.approvals.includes(approvalId)) task.approvals.push(approvalId);
  item.state = "APPROVED";
  item.evidence.push({ source: "human", observedAt: now(), summary: `Approved as ${approvalId}` });
  task.revision += 1;
  task.status = task.commitments.some((candidate) => candidate.requiresApproval && candidate.state === "AWAITING_APPROVAL")
    ? "AWAITING_APPROVAL"
    : "READY";
  event(task, "approval.recorded", item.label);
  return task;
}

export function setCommitmentState(task: TaskState, commitmentId: string, state: CommitmentState, evidence?: Evidence) {
  const item = task.commitments.find((candidate) => candidate.id === commitmentId);
  if (!item) throw new Error(`unknown commitment ${commitmentId}`);
  item.state = state;
  if (evidence) item.evidence.push(evidence);
  task.revision += 1;
  if (state === "UNKNOWN") task.status = "UNKNOWN";
  else if (state === "RECONCILING") task.status = "RECONCILING";
  else if (state === "EXECUTING") task.status = "EXECUTING";
  else if (state === "FAILED_SAFE") task.status = "FAILED_SAFE";
  event(task, `commitment.${state.toLowerCase()}`, item.label);
  return task;
}

export function finalizeTask(task: TaskState) {
  task.revision += 1;
  const verified = task.commitments.filter((item) => item.state === "VERIFIED").length;
  const failed = task.commitments.filter((item) => item.state === "FAILED_SAFE").length;
  task.status = failed > 0 ? (verified > 0 ? "PARTIAL" : "FAILED_SAFE") : verified === task.commitments.length ? "COMPLETED" : "PARTIAL";
  event(task, "task.finalized", `${verified}/${task.commitments.length} commitments independently verified`);
  return task;
}

export function completionReceipt(task: TaskState) {
  return {
    version: "asympta.receipt/solari-0.1",
    taskId: task.id,
    rootIntent: task.rootIntent,
    status: task.status,
    revision: task.revision,
    commitments: task.commitments.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      state: item.state,
      expected: item.expected,
      evidence: item.evidence,
    })),
    falseCompletionGuard: task.status === "COMPLETED" && task.commitments.every((item) => item.state === "VERIFIED"),
    events: task.events,
  };
}
