#!/usr/bin/env python3
"""
Morning digest — runs in GitHub Actions right after the daily scrape and
pushes the day's top new matches (plus follow-ups due, if your sheet is
connected) to your phone / inbox.

Channels (set whichever GitHub secrets you want; none set → prints and exits):
  NTFY_TOPIC            ntfy.sh topic (free app, no account). Pick an
                        unguessable name — anyone who knows it can read it.
  DISCORD_WEBHOOK_URL   Discord channel → Integrations → Webhooks → Copy URL
  SMTP_USER + SMTP_PASSWORD (+ DIGEST_EMAIL_TO, SMTP_HOST, SMTP_PORT)
                        e.g. Gmail + an App Password (Google Account →
                        Security → 2-Step Verification → App passwords)
  SHEET_EXEC_URL        your Apps Script /exec URL → adds "follow up today"
  DASHBOARD_URL         link used in the digest (defaults to GitHub Pages)
"""

import html
import json
import os
import smtplib
import sys
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests

from build_dashboard import load_jobs

DASHBOARD_URL = os.getenv("DASHBOARD_URL", "https://officialchanhen.github.io/Job-Search-Script/")
TOP_N = 10
FOLLOW_UP_DAYS = (7, 21)       # applications this many days old with no reply

MODE = {"onsite": "🏢", "hybrid": "🔀", "remote": "🌐"}


def top_new_jobs() -> tuple[list[dict], int, str]:
    jobs = load_jobs()
    latest = max((j["date"] for j in jobs), default="")
    new = [j for j in jobs if j["date"] == latest and not j.get("closed")]
    # full-time first, then Minnesota, then score (load_jobs already sorts by score)
    new.sort(key=lambda j: (j["jobType"] != "Full-time", not j["local"], -j["score"]))
    return new[:TOP_N], len(new), latest


def follow_ups() -> list[dict]:
    url = os.getenv("SHEET_EXEC_URL", "")
    if not url:
        return []
    try:
        rows = requests.get(url, params={"rows": 1}, timeout=30).json().get("rows", [])
    except (requests.RequestException, ValueError):
        return []
    today = datetime.now(timezone.utc).date()
    due = []
    for r in rows:
        status = (r.get("status") or "").lower()
        if status and "applied" not in status:
            continue
        d = _parse_date(r.get("date", ""))
        if not d:
            continue
        age = (today - d).days
        if FOLLOW_UP_DAYS[0] <= age <= FOLLOW_UP_DAYS[1]:
            due.append({**r, "age": age})
    return sorted(due, key=lambda r: -r["age"])[:5]


def _parse_date(v: str):
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(v.strip(), fmt).date()
        except ValueError:
            continue
    return None


def line(j: dict) -> str:
    tags = " ".join(filter(None, [
        MODE.get(j["mode"], ""), "📍MN" if j["local"] else "",
        "" if j["jobType"] == "Full-time" else f"[{j['jobType'] or 'type?'}]",
    ]))
    return f"{j['title']} — {j['company']} · {j['location']} {tags}".strip()


def build_text(jobs, total, day, fus) -> tuple[str, str]:
    title = f"🎯 {total} new job{'s' if total != 1 else ''} · {day}"
    parts = [f"Top {len(jobs)} (full-time & Minnesota first):"]
    parts += [f"• {line(j)}\n  {j['url']}" for j in jobs]
    if fus:
        parts.append("\n📬 Follow up today (no reply yet):")
        parts += [f"• {r.get('company', '')} — {r.get('title', '')} ({r['age']} days)" for r in fus]
    parts.append(f"\n🎮 Dashboard: {DASHBOARD_URL}")
    return title, "\n".join(parts)


def build_html(jobs, total, day, fus) -> str:
    e = html.escape
    rows = "".join(
        f'<li style="margin:0 0 10px"><a href="{e(j["url"])}" style="color:#2a78d6;font-weight:600;text-decoration:none">'
        f'{e(j["title"])}</a><br><span style="color:#52514e">{e(j["company"])} · {e(j["location"])} '
        f'{MODE.get(j["mode"], "")}{" · 📍 Minnesota" if j["local"] else ""}'
        f'{"" if j["jobType"] == "Full-time" else " · " + e(j["jobType"] or "type ?")}</span></li>'
        for j in jobs)
    fu = "".join(f"<li>{e(r.get('company', ''))} — {e(r.get('title', ''))} ({r['age']} days)</li>" for r in fus)
    return f"""<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:620px;color:#0b0b0b">
  <h2 style="margin:0 0 4px">🎯 {total} new job{'s' if total != 1 else ''} · {e(day)}</h2>
  <p style="color:#898781;margin:0 0 14px">Top {len(jobs)} — full-time and Minnesota first</p>
  <ul style="padding-left:18px">{rows}</ul>
  {f'<h3>📬 Follow up today</h3><ul>{fu}</ul>' if fu else ''}
  <p><a href="{e(DASHBOARD_URL)}" style="background:#2a78d6;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">🎮 Open dashboard</a></p>
</div>"""


def send_ntfy(topic, title, body) -> None:
    r = requests.post(f"https://ntfy.sh/{topic}", data=body.encode("utf-8"), timeout=20, headers={
        "Title": title.encode("utf-8"), "Click": DASHBOARD_URL, "Tags": "briefcase",
    })
    print(f"ntfy: HTTP {r.status_code}")


def send_discord(webhook, title, body) -> None:
    content = f"**{title}**\n{body}"
    # Discord messages max out at 2000 characters
    content = content if len(content) <= 1990 else content[:1985] + "…"
    r = requests.post(webhook, json={"content": content, "flags": 4}, timeout=20)   # 4 = no link embeds
    print(f"discord: HTTP {r.status_code}")


def send_email(title, body, html_body) -> None:
    user, pw = os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"]
    to = os.getenv("DIGEST_EMAIL_TO", user)
    host, port = os.getenv("SMTP_HOST", "smtp.gmail.com"), int(os.getenv("SMTP_PORT", "465"))
    msg = MIMEMultipart("alternative")
    msg["Subject"], msg["From"], msg["To"] = title, user, to
    msg.attach(MIMEText(body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    with smtplib.SMTP_SSL(host, port, timeout=30) as s:
        s.login(user, pw)
        s.sendmail(user, [a.strip() for a in to.split(",")], msg.as_string())
    print("email: sent")


def main() -> None:
    jobs, total, day = top_new_jobs()
    fus = follow_ups()
    title, body = build_text(jobs, total, day, fus)
    if "--dry-run" in sys.argv:
        print(title + "\n" + body)
        return
    if not jobs and not fus:
        print("Nothing new today — no digest sent.")
        return

    sent = False
    for name, fn in [
        ("NTFY_TOPIC", lambda: send_ntfy(os.environ["NTFY_TOPIC"], title, body)),
        ("DISCORD_WEBHOOK_URL", lambda: send_discord(os.environ["DISCORD_WEBHOOK_URL"], title, body)),
        ("SMTP_USER", lambda: send_email(title, body, build_html(jobs, total, day, fus))),
    ]:
        if os.getenv(name):
            try:
                fn()
                sent = True
            except Exception as exc:        # one channel failing shouldn't stop the others
                print(f"{name.split('_')[0].lower()} failed: {exc}")
    if not sent:
        print("No digest channel configured (NTFY_TOPIC / DISCORD_WEBHOOK_URL / SMTP_USER). Preview:\n")
        print(title + "\n" + body)


if __name__ == "__main__":
    main()
