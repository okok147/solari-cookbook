# Asympta Relay × Solari

> **Human intent, safely completed.**

This fork contains **Asympta Relay**, a Pinetree Research SWE internship build on top of Solari.

A person states an underspecified goal. Asympta creates one durable task, resolves only the next blocking requirement, constructs bounded commitments, stops at approval boundaries, executes through Solari, reconciles uncertain outcomes, and emits `COMPLETED` only when external evidence proves every commitment.

## Flagship use case

> “A contractor joins for three days. Give them only the access necessary for Project Cedar, notify the project lead, and ensure the access expires automatically.”

The isolated lab deliberately creates a hard reliability failure: the account creation **commits successfully and then returns HTTP 502**. A naive agent may retry and create a duplicate. Asympta instead enters `UNKNOWN → RECONCILING`, checks authoritative state in a separate Solari sandbox boundary, and continues without a blind retry.

**UNKNOWN is not FAILED.**

### Explore

- [`examples/asympta-relay-ts/`](./examples/asympta-relay-ts/) — runnable Solari Browser + Sandbox example
- [`BUILD_LOG.md`](./examples/asympta-relay-ts/BUILD_LOG.md) — hypothesis → failure → design change → evidence
- [`SUBMISSION_NOTES.md`](./examples/asympta-relay-ts/SUBMISSION_NOTES.md) — scope and evaluation notes
- **Website:** `https://okok147.github.io/solari-cookbook/` once GitHub Pages is enabled for this fork

## Run

```bash
cd examples/asympta-relay-ts
npm install
export SOLARI_API_KEY=slr_live_...
export DEMO_APPROVE=1
npm start
```

No real enterprise credentials are required. The example creates an isolated enterprise-admin lab in a Solari sandbox and operates it from a separate Solari cloud browser.

## Verify the kernel

```bash
cd examples/asympta-relay-ts
npm test
npm run typecheck
```

## Architecture

```text
human intent
  → durable task
  → next blocking requirement
  → commitments + constraints
  → approval
  → Solari browser execution
  → UNKNOWN if acknowledgement is ambiguous
  → reconciliation against authoritative sandbox state
  → independent verification
  → completion receipt
```

The model and executor are replaceable workers. They are not state authority.

---

## Upstream Solari Cookbook

This repository is forked from [`solari-sdk/solari-cookbook`](https://github.com/solari-sdk/solari-cookbook), which contains short runnable examples for Solari cloud browsers, sandboxes, and desktops.

MIT licensed.
