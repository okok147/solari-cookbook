import { readFile } from "node:fs/promises";
import { Solari } from "@solarisdk/browser";
import { SolariClient } from "@solarisdk/sdk";
import {
  answerRequirement,
  approveCommitment,
  completionReceipt,
  createTask,
  finalizeTask,
  nextBlockingRequirement,
  planTask,
  setCommitmentState,
  type Commitment,
  type Evidence,
  type Scenario,
  type TaskState,
} from "./task-kernel.js";

const API_KEY = process.env.SOLARI_API_KEY;
if (!API_KEY) throw new Error("SOLARI_API_KEY is required. Copy .env.example and export the key.");

const scenario: Scenario = process.env.ASYMPTA_SCENARIO === "offboard" ? "offboard" : "contractor";
const rootIntent = scenario === "contractor"
  ? "A contractor joins for three days. Give them only the access necessary for Project Cedar, notify the project lead, and ensure the access expires automatically."
  : "Remove this contractor's Project Cedar access today, preserve their records, and notify the project lead.";
const demoEmail = process.env.DEMO_CONTRACTOR_EMAIL ?? "sam.contractor@example.test";
const autoApprove = process.env.DEMO_APPROVE === "1";
const port = 3000;

function logHeading(text: string) {
  console.log(`\n=== ${text} ===`);
}

async function authoritativeState(sandbox: any) {
  return JSON.parse(await sandbox.files.readText("/tmp/asympta/state.json")) as {
    users: Record<string, { active: boolean }>;
    access: Array<{ email: string; project: string; active: boolean }>;
    expiry: Array<{ email: string; project: string; expiresAt: string }>;
    notifications: Array<{ email: string; project: string; delivered: boolean }>;
    records: Record<string, { preserved?: boolean }>;
    processed: string[];
  };
}

function evidence(summary: string, data?: Record<string, unknown>): Evidence {
  return { source: "sandbox", observedAt: new Date().toISOString(), summary, data };
}

function satisfied(commitment: Commitment, state: Awaited<ReturnType<typeof authoritativeState>>) {
  const email = String(commitment.expected.email ?? "");
  const project = String(commitment.expected.project ?? "");
  switch (commitment.kind) {
    case "create_identity": return Boolean(state.users[email]?.active);
    case "grant_access": return state.access.some((r) => r.email === email && r.project === project && r.active);
    case "schedule_expiry": return state.expiry.some((r) => r.email === email && r.project === project && r.expiresAt === commitment.expected.expiresAt);
    case "notify": return state.notifications.some((r) => r.email === email && r.project === project && r.delivered);
    case "revoke_access": return !state.access.some((r) => r.email === email && r.project === project && r.active);
    case "preserve_records": return Boolean(state.records[email]?.preserved);
  }
}

async function verify(task: TaskState, commitment: Commitment, sandbox: any) {
  setCommitmentState(task, commitment.id, "RECONCILING");
  const state = await authoritativeState(sandbox);
  if (satisfied(commitment, state)) {
    setCommitmentState(task, commitment.id, "VERIFIED", evidence("Expected effect independently observed in authoritative sandbox state", {
      commitment: commitment.kind,
      processedByIdempotencyKey: state.processed.includes(commitment.idempotencyKey),
    }));
    return true;
  }
  setCommitmentState(task, commitment.id, "FAILED_SAFE", evidence("Expected effect absent; stopped without claiming completion"));
  return false;
}

async function submit(page: any, button: string) {
  const responsePromise = page.waitForResponse((response: any) => response.request().method() === "POST", { timeout: 10_000 });
  await page.getByRole("button", { name: button, exact: true }).click();
  return responsePromise;
}

async function execute(task: TaskState, commitment: Commitment, page: any, sandbox: any, url: string) {
  if (commitment.requiresApproval && commitment.state !== "APPROVED") throw new Error(`approval required before ${commitment.label}`);
  setCommitmentState(task, commitment.id, "EXECUTING", { source: "browser", observedAt: new Date().toISOString(), summary: `Solari browser began: ${commitment.label}` });
  const email = String(commitment.expected.email ?? "");
  const project = String(commitment.expected.project ?? "");
  await page.goto(url);
  try {
    const forms: Record<string, [string, string, Record<string, string>]> = {
      create_identity: ["form[action='/create-user']", "Create account", { email, idempotency_key: commitment.idempotencyKey }],
      grant_access: ["form[action='/grant-access']", "Grant access", { email, project, idempotency_key: commitment.idempotencyKey }],
      revoke_access: ["form[action='/revoke-access']", "Revoke access", { email, project, idempotency_key: commitment.idempotencyKey }],
      schedule_expiry: ["form[action='/schedule-expiry']", "Schedule expiry", { email, project, expires_at: String(commitment.expected.expiresAt), idempotency_key: commitment.idempotencyKey }],
      preserve_records: ["form[action='/preserve-records']", "Preserve records", { email, idempotency_key: commitment.idempotencyKey }],
      notify: ["form[action='/notify']", "Notify project lead", { email, project, idempotency_key: commitment.idempotencyKey }],
    };
    const [selector, button, fields] = forms[commitment.kind];
    const form = page.locator(selector);
    for (const [name, value] of Object.entries(fields)) await form.locator(`input[name=${name}]`).fill(value);
    if (commitment.kind === "create_identity") await form.locator("input[name=inject_uncertain]").check();
    const response = await submit(page, button);
    if (response.status() >= 500) {
      setCommitmentState(task, commitment.id, "UNKNOWN", { source: "browser", observedAt: new Date().toISOString(), summary: `HTTP ${response.status()} after submit; outcome UNKNOWN, not FAILED` });
      return verify(task, commitment, sandbox);
    }
  } catch (error) {
    setCommitmentState(task, commitment.id, "UNKNOWN", { source: "browser", observedAt: new Date().toISOString(), summary: `Acknowledgement uncertain: ${error instanceof Error ? error.message : String(error)}` });
    return verify(task, commitment, sandbox);
  }
  return verify(task, commitment, sandbox);
}

async function main() {
  logHeading("1. Human intent → durable task");
  const task = createTask(rootIntent, scenario);
  let blocker = nextBlockingRequirement(task);
  while (blocker) {
    const answer = blocker.semantic === "subject_email" ? demoEmail : blocker.semantic === "project" ? "Project Cedar" : blocker.semantic === "duration_days" ? "3" : "yes";
    console.log(`BLOCKING QUESTION: ${blocker.question}`);
    answerRequirement(task, { commandId: `answer:${blocker.id}:${task.revision}`, requirementId: blocker.id, expectedRevision: task.revision, value: answer });
    blocker = nextBlockingRequirement(task);
  }
  planTask(task, scenario);
  for (const item of task.commitments.filter((c) => c.requiresApproval)) {
    if (!autoApprove) throw new Error(`Stopped safely at approval boundary: ${item.label}. Re-run with DEMO_APPROVE=1 inside the isolated lab.`);
    approveCommitment(task, item.id, `demo-human-approval:${item.id}`);
  }

  const client = new SolariClient({ apiKey: API_KEY });
  const sandbox = await client.sandboxes.create({ template: "base", timeoutMs: 10 * 60_000 });
  const solariBrowser = new Solari({ apiKey: API_KEY });
  let browser: any;
  try {
    await sandbox.connect();
    await sandbox.files.write("/tmp/asympta/lab.py", await readFile(new URL("./lab.py", import.meta.url), "utf8"));
    await sandbox.commands.run("sh", { args: ["-c", `PORT=${port} ASYMPTA_LAB_SCENARIO=${scenario} DEMO_EMAIL=${demoEmail} nohup python3 /tmp/asympta/lab.py >/tmp/asympta/lab.log 2>&1 &`] });
    const { url } = await sandbox.previewUrl(port);
    for (let i = 0; i < 15; i++) {
      if ((await fetch(url).catch(() => undefined))?.ok) break;
      await new Promise((r) => setTimeout(r, 500));
      if (i === 14) throw new Error("enterprise lab did not become ready");
    }
    browser = await solariBrowser.launch();
    const page = await browser.newPage();
    for (const item of task.commitments) {
      const ok = await execute(task, item, page, sandbox, url);
      console.log(ok ? "VERIFIED" : "FAILED_SAFE", item.label);
    }
    finalizeTask(task);
    console.log(JSON.stringify({ ...completionReceipt(task), solari: { sandboxId: sandbox.sandboxId, browserSessionId: browser.id }, finalAuthoritativeState: await authoritativeState(sandbox) }, null, 2));
    if (task.status !== "COMPLETED") process.exitCode = 2;
  } finally {
    if (browser) await browser.close();
    await solariBrowser.close();
    await sandbox.kill();
  }
}

await main();
