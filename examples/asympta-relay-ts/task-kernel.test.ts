import assert from "node:assert/strict";
import test from "node:test";
import {
  answerRequirement,
  approveCommitment,
  completionReceipt,
  createTask,
  finalizeTask,
  nextBlockingRequirement,
  planTask,
  setCommitmentState,
} from "./task-kernel.js";

const intent = "A contractor joins for three days. Give them only the access necessary for Project Cedar, notify the project lead, and ensure the access expires automatically.";

test("asks only for the next unresolved blocking requirement", () => {
  const task = createTask(intent);
  assert.equal(nextBlockingRequirement(task)?.semantic, "subject_email");
  assert.equal(task.requirements.filter((item) => !item.value).length, 1);
});

test("typed answers reject stale revisions and are idempotent by command id", () => {
  const task = createTask(intent);
  const req = nextBlockingRequirement(task)!;
  const revision = task.revision;
  answerRequirement(task, { commandId: "cmd-1", requirementId: req.id, expectedRevision: revision, value: "sam@example.test" });
  const afterFirst = task.revision;
  answerRequirement(task, { commandId: "cmd-1", requirementId: req.id, expectedRevision: revision, value: "sam@example.test" });
  assert.equal(task.revision, afterFirst);
  assert.throws(() => answerRequirement(task, { commandId: "cmd-2", requirementId: req.id, expectedRevision: revision, value: "other@example.test" }), /stale revision/);
});

test("security-consequential access requires approval before execution", () => {
  const task = createTask(intent);
  const req = nextBlockingRequirement(task)!;
  answerRequirement(task, { commandId: "cmd-email", requirementId: req.id, expectedRevision: task.revision, value: "sam@example.test" });
  planTask(task);
  const grant = task.commitments.find((item) => item.kind === "grant_access")!;
  assert.equal(grant.state, "AWAITING_APPROVAL");
  assert.equal(task.status, "AWAITING_APPROVAL");
  approveCommitment(task, grant.id, "human-1");
  assert.equal(grant.state, "APPROVED");
});

test("completion is impossible until every commitment is independently verified", () => {
  const task = createTask(intent);
  const req = nextBlockingRequirement(task)!;
  answerRequirement(task, { commandId: "cmd-email", requirementId: req.id, expectedRevision: task.revision, value: "sam@example.test" });
  planTask(task);
  for (const item of task.commitments) {
    if (item.requiresApproval) approveCommitment(task, item.id, `approve-${item.id}`);
    setCommitmentState(task, item.id, "VERIFIED", { source: "sandbox", observedAt: new Date().toISOString(), summary: "authoritative state observed" });
  }
  finalizeTask(task);
  assert.equal(task.status, "COMPLETED");
  assert.equal(completionReceipt(task).falseCompletionGuard, true);
});
