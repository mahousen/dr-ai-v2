#!/usr/bin/env python3
"""Mac repair script - ASCII only, no CJK chars"""
import json, base64, os, sys
from urllib.request import Request, urlopen

API = "https://api.github.com/repos/mahousen/dr-ai-v2/contents"
HOME = os.path.expanduser("~")
DIR = None

# Search for app folder (no Chinese in code)
for candidate in [
    os.path.join(HOME, "Downloads"),
    os.path.join(HOME, "Desktop"),
]:
    if os.path.isdir(candidate):
        for item in os.listdir(candidate):
            full = os.path.join(candidate, item)
            if os.path.isdir(full) and os.path.exists(os.path.join(full, "server.js")):
                DIR = full
                break
    if DIR:
        break

if not DIR:
    print("ERROR: cannot find app folder")
    sys.exit(1)

print("Found:", DIR)

FILES = ["index.html", "server.js", "version.txt", "check_update.py"]

t = ""
for a in sys.argv[1:]:
    if a.startswith("--token="):
        t = a.split("=", 1)[1]

if not t:
    t = os.environ.get("GH_TOKEN", "")

if not t:
    print("Usage: python3 fix_mac.py --token=TOKEN")
    sys.exit(1)

ok = 0
fail = 0
for name in FILES:
    try:
        url = API + "/" + name
        req = Request(url)
        req.add_header("Authorization", "Bearer " + t)
        resp = urlopen(req, timeout=15)
        data = json.loads(resp.read())
        content = base64.b64decode(data["content"]).decode("utf-8")
        path = os.path.join(DIR, name)
        f = open(path, "w", encoding="utf-8")
        f.write(content)
        f.close()
        print("OK:", name)
        ok += 1
    except Exception as e:
        print("FAIL:", name, e)
        fail += 1

# Make desktop launcher (ASCII only)
desktop = os.path.join(HOME, "Desktop", "launcher.command")
f = open(desktop, "w", encoding="utf-8")
f.write("#!/bin/bash\n")
f.write('D="' + DIR + '"\n')
f.write('cd "$D" || exit 1\n')
f.write("python3 check_update.py 2>/dev/null\n")
f.write("[ ! -d node_modules/ws ] && npm install 2>/dev/null\n")
f.write("open http://localhost:8080 2>/dev/null &\n")
f.write("node server.js\n")
f.close()
os.chmod(desktop, 0o755)
print("OK: desktop launcher")
print("DONE: ok=%d fail=%d" % (ok, fail))
