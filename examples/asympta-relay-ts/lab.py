import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

PORT = int(os.getenv("PORT", "3000"))
ROOT = Path("/tmp/asympta")
STATE_PATH = ROOT / "state.json"
ROOT.mkdir(parents=True, exist_ok=True)

def initial_state():
    state = {"users": {}, "access": [], "expiry": [], "notifications": [], "records": {}, "processed": [], "events": [], "uncertain_create_injected": False}
    if os.getenv("ASYMPTA_LAB_SCENARIO") == "offboard":
        email = os.getenv("DEMO_EMAIL", "sam.contractor@example.test")
        state["users"][email] = {"name": "Temporary contractor", "active": True}
        state["access"].append({"email": email, "project": "Project Cedar", "active": True})
        state["records"][email] = {"preserved": False}
    return state

def save_state(state): STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True))
def load_state():
    if not STATE_PATH.exists(): save_state(initial_state())
    return json.loads(STATE_PATH.read_text())

def page(body):
    return f"""<!doctype html><meta charset='utf-8'><title>Asympta Enterprise Lab</title><style>body{{font:14px system-ui;max-width:760px;margin:40px auto;padding:0 22px;background:#f3f2ec;color:#20231f}}.card{{background:#fffef8;border:1px solid #d8d5ca;border-radius:16px;padding:18px;margin:14px 0}}label{{display:block;margin:9px 0 3px}}input{{width:100%;box-sizing:border-box;padding:9px;border:1px solid #ccc;border-radius:8px}}button{{margin-top:12px;padding:9px 13px;border:0;border-radius:999px;background:#252820;color:white}}</style><h1>Asympta Enterprise Lab</h1><p>Authoritative state lives in the Solari sandbox. The browser is only an operator.</p>{body}"""

FORMS = """
<div class='card'><h2>Create identity</h2><form method='post' action='/create-user'><label>Email</label><input name='email'><label>Idempotency key</label><input name='idempotency_key'><label><input type='checkbox' name='inject_uncertain' value='yes'> Inject 502 after commit</label><button>Create account</button></form></div>
<div class='card'><h2>Project access</h2><form method='post' action='/grant-access'><label>Email</label><input name='email'><label>Project</label><input name='project'><label>Idempotency key</label><input name='idempotency_key'><button>Grant access</button></form><form method='post' action='/revoke-access'><label>Email</label><input name='email'><label>Project</label><input name='project'><label>Idempotency key</label><input name='idempotency_key'><button>Revoke access</button></form></div>
<div class='card'><h2>Expiry</h2><form method='post' action='/schedule-expiry'><label>Email</label><input name='email'><label>Project</label><input name='project'><label>Expires at</label><input name='expires_at'><label>Idempotency key</label><input name='idempotency_key'><button>Schedule expiry</button></form></div>
<div class='card'><h2>Records</h2><form method='post' action='/preserve-records'><label>Email</label><input name='email'><label>Idempotency key</label><input name='idempotency_key'><button>Preserve records</button></form></div>
<div class='card'><h2>Notify</h2><form method='post' action='/notify'><label>Email</label><input name='email'><label>Project</label><input name='project'><label>Idempotency key</label><input name='idempotency_key'><button>Notify project lead</button></form></div>
"""

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): print("LAB", fmt % args, flush=True)
    def send(self, body, status=200, ctype="text/html; charset=utf-8"):
        data = body.encode(); self.send_response(status); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def form(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode()
        return {k: v[0] for k, v in parse_qs(raw).items()}
    def do_GET(self):
        if self.path == "/state.json": return self.send(json.dumps(load_state(), indent=2), ctype="application/json")
        if self.path == "/": return self.send(page(FORMS))
        return self.send(page("Not found"), 404)
    def duplicate(self, state, key):
        if key not in state["processed"]: return False
        state["events"].append({"type": "duplicate.prevented", "key": key}); save_state(state); self.send(page("<h2>Already applied — duplicate prevented</h2>")); return True
    def do_POST(self):
        data, state = self.form(), load_state(); key = data.get("idempotency_key", "")
        if not key: return self.send(page("Missing idempotency key"), 400)
        if self.duplicate(state, key): return
        email, project = data.get("email", ""), data.get("project", "")
        if self.path == "/create-user":
            state["users"][email] = {"name": "Temporary contractor", "active": True}; state["records"].setdefault(email, {"preserved": False}); state["processed"].append(key); state["events"].append({"type": "identity.created", "email": email, "key": key})
            if data.get("inject_uncertain") == "yes" and not state["uncertain_create_injected"]:
                state["uncertain_create_injected"] = True; save_state(state); return self.send(page("<h2>502 acknowledgement lost after commit</h2>"), 502)
        elif self.path == "/grant-access":
            row = {"email": email, "project": project, "active": True}; state["access"] = [x for x in state["access"] if not (x["email"] == email and x["project"] == project)] + [row]; state["processed"].append(key)
        elif self.path == "/revoke-access":
            for row in state["access"]:
                if row["email"] == email and row["project"] == project: row["active"] = False
            state["processed"].append(key)
        elif self.path == "/schedule-expiry": state["expiry"].append({"email": email, "project": project, "expiresAt": data.get("expires_at", "")}); state["processed"].append(key)
        elif self.path == "/preserve-records": state["records"].setdefault(email, {})["preserved"] = True; state["processed"].append(key)
        elif self.path == "/notify": state["notifications"].append({"email": email, "project": project, "delivered": True}); state["processed"].append(key)
        else: return self.send(page("Not found"), 404)
        save_state(state); return self.send(page("<h2>Applied</h2>"))

if __name__ == "__main__":
    save_state(initial_state()); print(f"Asympta lab listening on {PORT}", flush=True); ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
