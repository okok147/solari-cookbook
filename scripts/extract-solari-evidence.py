import datetime
import json
import os
import pathlib

log_path = pathlib.Path("site/latest-run.log")
text = log_path.read_text()
marker = "=== 5. Completion receipt ===\n"
if marker not in text:
    raise SystemExit("completion receipt marker not found")

receipt = json.loads(text.split(marker, 1)[1].strip())
if receipt.get("status") != "COMPLETED":
    raise SystemExit(f"task not completed: {receipt.get('status')}")
if receipt.get("falseCompletionGuard") is not True:
    raise SystemExit("falseCompletionGuard was not true")

solari = receipt.get("solari") or {}
if not solari.get("sandboxId") or not solari.get("browserSessionId"):
    raise SystemExit("missing Solari session IDs")

artifact = {
    "schema": "asympta.solari.evidence/0.2",
    "verified": True,
    "execution": "real-solari",
    "scenario": os.environ.get("ASYMPTA_SCENARIO", "contractor"),
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "provenance": {
        "repository": os.environ.get("GITHUB_REPOSITORY"),
        "commit": os.environ.get("GITHUB_SHA"),
        "workflowRunId": os.environ.get("GITHUB_RUN_ID"),
    },
    "solari": solari,
    "receipt": {k: v for k, v in receipt.items() if k not in ("solari", "finalAuthoritativeState")},
    "finalAuthoritativeState": receipt.get("finalAuthoritativeState"),
    "rawLog": "latest-run.log",
}
pathlib.Path("site/latest-run.json").write_text(json.dumps(artifact, indent=2) + "\n")
print(json.dumps({"verified": True, "sandboxId": solari["sandboxId"], "browserSessionId": solari["browserSessionId"]}))
