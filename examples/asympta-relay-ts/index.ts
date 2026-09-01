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

const API_KEY: string = process.env.SOLARI_API_KEY ?? "";
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

function requirementValue(task: TaskState, semantic: string) {
  return task.requirements.find((item) => item.semantic === semantic)?.value ?? "";
}

async function authoritativeState(sandbox: any) {
  return JSON.parse(await sandbox.files.readText("/tmp/asympta/state.json")) as {
    users: Record<string, { active: boolean }>;
    access: Array<{ email: string; project: string; active: boolean }>;
    expiry: Array<{ email: string; project: string; expiresAt: string }>;
    notifications: Array<{ email: string; project: string; delivered: boolean }>;
    records: Record<string, { preserved?: boolean }>;
    processed: string[];
    events: Array<Record<string, unknown>>;
  };
}

function observedAtEvidence(summary: string, data?: Record<string, unknown>): Evidence {
  return { source: "sandbox", observedAt: new Date().toISOString(), summary, data };
}

function effectSatisfied(commitment: Commitment, state: Awaited<ReturnType<typeof authoritativeState>>) {
  const email = String(commitment.expected.email ?? "");
  const project = String(commitment.expected.project ?? "");
  switch (commitment.kind) {
    case "create_identity":
      return Boolean(state.users[email]?.active);
    case "grant_access":
      return state.access.some((row) => row.email === email && row.project === project && row.active);
    case "schedule_expiry":
      return state.expiry.some((row) => row.email === email && row.project === project && row.expiresAt === commitment.expected.expiresAt);
    case "notify":
      return state.notifications.some((row) => row.email === email && row.project === project && row.delivered);
    case "revoke_access":
      return state.access.some((row) => row.email === email && row.project === project && !row.active) || !state.access.some((row) => row.email === email && row.project === project && row.active);
    case "preserve_records":
      return Boolean(state.records[email]?.preserved);
  }
}

async function verify(task: TaskState, commitment: Commitment, sandbox: any) {
  setCommitmentState(task, commitment.id, "RECONCILING");
  const state = await authoritativeState(sandbox);
  const satisfied = effectSatisfied(commitment, state);
  if (satisfied) {
    setCommitmentState(task, commitment.id, "VERIFIED", observedAtEvidence("Expected effect independently observed in sandbox authoritative state", {
      commitment: commitment.kind,
      processedByIdempotencyKey: state.processed.includes(commitment.idempotencyKey),
    }));
    return true;
  }
  setCommitmentState(task, commitment.id, "FAILED_SAFE", observedAtEvidence("Expected effect was not present; Asympta stopped rather than claiming completion"));
  return false;
}

async function submit(page: any, button: string) {
  const responsePromise = page.waitForResponse((response: any) => response.request().method() === "POST", { timeout: 10_000 });
  await page.getByRole("button", { name: button, exact: true }).click();
  return responsePromise;
}

async function executeCommitment(task: TaskState, commitment: Commitment, page: any, sandbox: any, previewUrl: string) {
  if (commitment.requiresApproval && commitment.state !== "APPROVED") {
    throw new Error(`approval required before ${commitment.label}`);
  }

  setCommitmentState(task, commitment.id, "EXECUTING", {
    source: "browser",
    observedAt: new Date().toISOString(),
    summary: `Solari browser began: ${commitment.label}`,
  });

  const email = String(commitment.expected.email ?? "");
  const project = String(commitment.expected.project ?? "");
  await page.goto(previewUrl);

  try {
    if (commitment.kind === "create_identity") {
      const form = page.locator("form[action='/create-user']");
      await form.locator("input[name=email]").fill(email);
      await form.locator("input[name=idempotency_key]").fill(commitment.idempotencyKey);
      await form.locator("input[name=inject_uncertain]").check();
      const response = await submit(page, "Create account");
      if (response.status() >= 500) {
        setCommitmentState(task, commitment.id, "UNKNOWN", {
          source: "browser",
          observedAt: new Date().toISOString(),
          summary: `Browser received HTTP ${response.status()} after submit; outcome is UNKNOWN, not FAILED`,
        });
        return verify(task, commitment, sandbox);
      }
    } else if (commitment.kind === "grant_access") {
      const form = page.locator("form[action='/grant-access']");
      await form.locator("input[name=email]").fill(email);
      await form.locator("input[name=project]").fill(project);
      await form.locator("input[name=idempotency_key]").fill(commitment.idempotencyKey);
      await submit(page, "Grant access");
    } else if (commitment.kind === "revoke_access") {
      const form = page.locator("form[action='/revoke-access']");
      await form.locator("input[name=email]").fill(email);
      await form.locator("input[name=project]").fill(project);
      await form.locator("input[name=idempotency_key]").fill(commitment.idempotencyKey);
      await submit(page, "Revoke access");
    } else if (commitment.kind === "schedule_expiry") {
      const form = page.locator("form[action='/schedule-expiry']");
      await form.locator("input[name=email]").fill(email);
      await form.locator("input[name=project]").fill(project);
      await form.locator("input[name=expires_at]").fill(String(commitment.expected.expiresAt));
      await form.locator("input[name=idempotency_key]").fill(commitment.idempotencyKey);
      await submit(page, "Schedule expiry");
    } else if (commitment.kind === "preserve_records") {
      const form = page.locator("form[action='/preserve-records']");
      await form.locator("input[name=email]").fill(email);
      await form.locator("input[name=idempotency_key]").fill(commitment.idempotencyKey);
      await submit(page, "Preserve records");
    } else if (commitment.kind === "notify") {
      const form = page.locator("form[action='/notify']");
      await form.locator("input[name=email]").fill(email);
      await form.locator("input[name=project]").fill(project);
      await form.locator("input[name=idempotency_key]").fill(commitment.idempotencyKey);
      await submit(page, "Notify project lead");
    }
  } catch (error) {
    setCommitmentState(task, commitment.id, "UNKNOWN", {
      source: "browser",
      observedAt: new Date().toISOString(),
      summary: `Execution acknowledgement was uncertain: ${error instanceof Error ? error.message : String(error)}`,
    });
    return verify(task, commitment, sandbox);
  }

  return verify(task, commitment, sandbox);
}

async function main() {
  logHeading("1. Human intent → durable task");
  const task = createTask(rootIntent, scenario);
  console.log(rootIntent);

  let blocker = nextBlockingRequirement(task);
  while (blocker) {
    console.log(`BLOCKING QUESTION: ${blocker.question}`);
    const answer = blocker.semantic === "subject_email"
      ? demoEmail
      : blocker.semantic === "project"
        ? "Project Cedar"
        : blocker.semantic === "duration_days"
          ? "3"
          : blocker.semantic === "least_privilege" || blocker.semantic === "preserve_records"
            ? "yes"
            : "demo";
    answerRequirement(task, {
      commandId: `answer:${blocker.id}:${task.revision}`,
      requirementId: blocker.id,
      expectedRevision: task.revision,
      value: answer,
    });
    console.log(`ANSWERED: ${blocker.semantic} = ${answer}`);
    blocker = nextBlockingRequirement(task);
  }

  planTask(task, scenario);
  logHeading("2. Commitments");
  for (const item of task.commitments) {
    console.log(`${item.requiresApproval ? "[approval]" : "[safe]"} ${item.kind}: ${item.label}`);
  }

  for (const item of task.commitments.filter((candidate) => candidate.requiresApproval)) {
    if (!autoApprove) {
      throw new Error(`Demo stopped safely at approval boundary for: ${item.label}. Re-run with DEMO_APPROVE=1 to approve inside the isolated demo lab.`);
    }
    approveCommitment(task, item.id, `demo-human-approval:${item.id}`);
  }

  logHeading("3. Launch Solari sandbox — authoritative enterprise state");
  const client = new SolariClient({ apiKey: API_KEY });
  const sandbox = await client.sandboxes.create({ template: "base", timeoutMs: 10 * 60_000 });
  console.log("sandbox:", sandbox.sandboxId);

  const solariBrowser = new Solari({ apiKey: API_KEY });
  let browser: any;
  try {
    await sandbox.connect();
    const labSource = await readFile(new URL("./lab.py", import.meta.url), "utf8");
    await sandbox.files.write("/tmp/asympta/lab.py", labSource);
    await sandbox.commands.run("sh", {
      args: ["-c", `PORT=${port} ASYMPTA_LAB_SCENARIO=${scenario} DEMO_EMAIL=${demoEmail} nohup python3 /tmp/asympta/lab.py >/tmp/asympta/lab.log 2>&1 &`],
    });
    const { url: previewUrl } = await sandbox.previewUrl(port);
    console.log("lab:", previewUrl);

    for (let i = 0; i < 15; i++) {
      const response = await fetch(previewUrl).catch(() => undefined);
      if (response?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (i === 14) throw new Error("enterprise lab did not become ready");
    }

    logHeading("4. Launch Solari browser — computer-use executor");
    browser = await solariBrowser.launch();
    console.log("browser session:", browser.id);
    const page = await browser.newPage();

    for (const item of task.commitments) {
      console.log(`\nEXECUTE ${item.kind}`);
      const ok = await executeCommitment(task, item, page, sandbox, previewUrl);
      console.log(ok ? "VERIFIED" : "FAILED_SAFE", item.label);
    }

    finalizeTask(task);
    logHeading("5. Completion receipt");
    console.log(JSON.stringify({
      ...completionReceipt(task),
      solari: { sandboxId: sandbox.sandboxId, browserSessionId: browser.id },
      finalAuthoritativeState: await authoritativeState(sandbox),
    }, null, 2));

    if (task.status !== "COMPLETED") process.exitCode = 2;
  } finally {
    if (browser) await browser.close();
    await solariBrowser.close();
    await sandbox.kill();
  }
}

await main();
