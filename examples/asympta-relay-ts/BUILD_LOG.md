# Build log

## 2026-09-01 — Day 0: execution uncertainty is a first-class state

### Starting question

Can a person state an operational goal without knowing the exact workflow, while the system remains honest about whether external actions really happened?

### Existing Asympta insight carried forward

A human intention creates one durable task. Models and executors may propose or perform work, but they are not the authority for task state. Consequential work must cross an approval boundary and completion requires independent evidence.

### First Solari-native use case

> A contractor joins for three days. Give them only the access necessary for Project Cedar, notify the project lead, and ensure the access expires automatically.

The thin slice uses:

- a Solari **sandbox** as the authoritative enterprise environment;
- a Solari **cloud browser** as the computer-use executor;
- a durable task/commitment model above both;
- an independent verifier that reads sandbox state rather than trusting browser text.

### Adversarial failure selected before polishing

The account-creation endpoint commits the account, then deliberately returns HTTP 502 once.

Naive behavior:

```text
POST → 502 → assume failure → retry
```

That can duplicate a non-idempotent external action.

Asympta behavior:

```text
POST → 502
  → UNKNOWN
  → RECONCILING
  → inspect authoritative state
  → effect already exists
  → VERIFIED
  → do not blindly retry
```

### Local evidence

- Kernel invariants: **4/4 passed**.
- Python enterprise lab syntax: passed `py_compile`.
- Integration source: passed an offline TypeScript syntax/type check with SDK shims matching the cookbook APIs.
- Failure reproduction: first account creation returned **HTTP 502** while the authoritative state contained the account.
- Repeating the same idempotency key produced exactly **one** `identity.created` event and one `duplicate.prevented` event.

### Not yet claimed

- The public fork now exists at `okok147/solari-cookbook`, and this reference implementation is committed there.
- A live Solari end-to-end run is **not yet claimed** because this execution environment does not contain a `SOLARI_API_KEY`.
- Cross-domain universality is **not claimed**. The current implementation is a reference slice designed to make the task/commitment/reconciliation boundary testable first.

### Next evidence milestone

Run the exact example against Solari with a real `SOLARI_API_KEY`, preserve the browser session/sandbox IDs and completion receipt, then add an unseen-task evaluation without changing the kernel. The GitHub Pages site is a deterministic visualization only and does not ship a secret key to the browser.
