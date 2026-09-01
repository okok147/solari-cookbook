# Pinetree / Solari submission notes

## Working title

**Asympta — Human intent, safely completed.**

Technical subtitle: **A durable intent-to-verified-action layer for computer-use agents, powered by Solari.**

## 90-second demo arc

1. Show the human request: “A contractor joins for three days…”
2. Asympta identifies only one unresolved blocker: contractor email.
3. Show four commitments: create identity, grant least-privilege access, schedule expiry, notify lead.
4. Stop visibly at approval for the permission grant.
5. Approve inside the isolated demo lab.
6. Solari browser submits account creation.
7. The lab commits the account but returns 502.
8. Highlight: `UNKNOWN`, not `FAILED`; no blind retry.
9. Asympta reads authoritative sandbox state and reconciles the already-completed action.
10. Continue remaining commitments and print a completion receipt with independent evidence.
11. Run the offboarding scenario to show the same kernel producing a different commitment set.

## Claim to make

> Solari gives an agent a browser, sandbox, and desktop. Asympta explores the layer above execution: what must be true before an action is safe to perform, and what evidence must exist before the system is allowed to say it finished.

## Claim not to make yet

Do not call the implementation “universal” until unseen-task benchmarks support that claim.
