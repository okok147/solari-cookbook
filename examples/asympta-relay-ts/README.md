# Asympta Relay — intent to verified action on Solari

> **A person should be able to state a goal without first knowing every app, field, actor, or workflow required to accomplish it.**

This example combines an Asympta-style durable task kernel with **real Solari browser + sandbox execution**.

The flagship request is intentionally underspecified:

> “A contractor joins for three days. Give them only the access necessary for Project Cedar, notify the project lead, and ensure the access expires automatically.”

The demo does not treat an LLM or browser message as truth. It creates one durable task, resolves the next blocking unknown, creates typed commitments, stops at an approval boundary, executes through a Solari cloud browser, and independently verifies the resulting state from the Solari sandbox.

## Why this use case

Typical browser demos show that an agent can click. This demonstrates the harder boundary around the click:

```text
human intent
  → durable task
  → next blocking requirement
  → commitments + constraints
  → approval
  → Solari browser execution
  → UNKNOWN when acknowledgement is ambiguous
  → reconciliation against authoritative sandbox state
  → independently verified completion receipt
```

The first account creation deliberately returns **HTTP 502 after the state has already committed**. A naive agent retries and risks a duplicate account. Asympta marks the outcome `UNKNOWN`, checks the authoritative state, adopts the already-completed effect, and continues without a blind retry.

That distinction — **UNKNOWN is not FAILED** — is the reliability idea this example is designed to make visible.

## Reproducible by reviewers

No Okta, Google Workspace, or Jira credentials are required. The example boots a small enterprise-admin surface *inside a real Solari sandbox* and exposes it with a Solari preview URL. A separate Solari cloud browser operates that UI. The independent verifier reads the sandbox's state file directly rather than trusting the browser DOM.

The lab is intentionally replaceable. In a production deployment, the same task/commitment/verifier boundary can sit in front of real SaaS or desktop systems.

## Run

```bash
npm install
export SOLARI_API_KEY=slr_live_...
export DEMO_APPROVE=1
npm start
```

Optional:

```bash
export DEMO_CONTRACTOR_EMAIL=sam.contractor@example.test
```

`DEMO_APPROVE=1` is only an explicit approval inside the isolated demo lab. Without it, the program stops safely before granting access.

## Second task, same kernel

Run an offboarding-shaped request through the same task representation:

```bash
SOLARI_API_KEY=... DEMO_APPROVE=1 npm run demo:offboard
```

The second scenario changes the commitments to revoke project access, preserve records, and notify the lead. The task kernel, revision/idempotency model, approval boundary, executor, verifier, and completion receipt remain the same.

## What is Asympta-specific

The reference kernel preserves several design constraints from Asympta World:

- one human intention creates one durable task;
- models and executors are replaceable workers, not state authority;
- requirements are typed and human-confirmed values are locked;
- stale revisions are rejected;
- command IDs are idempotent;
- consequential commitments require approval;
- uncertain execution enters `UNKNOWN`/`RECONCILING`, not an automatic retry;
- `COMPLETED` is only emitted when every commitment has independent evidence.

## Verify the local kernel

```bash
npm test
npm run typecheck
```

## Scope

This is a **reference execution slice**, not a claim that the current parser understands every human task. The research/product question is whether the same durable-task + commitment + verification abstraction can transfer across unfamiliar workflows while keeping false completion and duplicate side effects near zero.

The next evaluation step is deliberately adversarial: unseen tasks, changed UI, expired auth, partial completion, duplicate-action risk, and approval revocation.
