#!/usr/bin/env python3
"""M5.4 (PRD E0.8): hold one SSE connection to /api/runs/<id>/live for a long run and log every event.

usage: sse_watch.py BASE_URL RUN_ID COOKIE_FILE STOP_AFTER_SEC [STOP_COOKIE_FILE]
Logs "<epoch> <seconds since connect> <event> <samples in the event> <status>" per event; after STOP_AFTER_SEC it
sends the emergency stop (engineer cookie) and keeps reading until `end`. Gaps between ticks are what to look at.
"""
import json, sys, time, urllib.request

base, run_id, cookie_file, stop_after = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
stop_cookie = open(sys.argv[5]).read().strip() if len(sys.argv) > 5 else None
cookie = open(cookie_file).read().strip()
req = urllib.request.Request(f"{base}/api/runs/{run_id}/live", headers={"Cookie": cookie, "Accept": "text/event-stream"})
t0, stopped, event, last = time.time(), False, None, time.time()
with urllib.request.urlopen(req, timeout=120) as res:
    for raw in res:
        line = raw.decode().rstrip("\n")
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            d = json.loads(line[6:])
            now = time.time()
            print(f"{int(now)} {now - t0:8.1f} gap={now - last:5.1f} {event} samples={len(d.get('samples', []))} status={d.get('status')}", flush=True)
            last = now
            if event == "end":
                break
            if stop_cookie and not stopped and now - t0 >= stop_after:
                r = urllib.request.Request(f"{base}/api/runs/{run_id}/stop", method="POST", data=b"{}", headers={"Cookie": stop_cookie, "Content-Type": "application/json"})
                print(f"{int(now)} stop requested -> HTTP {urllib.request.urlopen(r).status}", flush=True)
                stopped = True
print(f"closed after {time.time() - t0:.0f} s", flush=True)
