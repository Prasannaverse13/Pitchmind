"""PitchMind API. Streams agent activity to the dashboard with server sent events,
and runs the club game: managers, AI built clubs, invite codes, chat, challenges and a trophy ladder.

Run:  uvicorn main:app --reload --port 8000
"""
import asyncio
import json
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv()

from pitchmind import events as bus  # noqa: E402
from pitchmind import telemetry  # noqa: E402
from pitchmind.agents import build_team  # noqa: E402
from pitchmind.engine import play  # noqa: E402
from pitchmind.league import League, clean_club, random_club  # noqa: E402
from pitchmind.orchestrator import _json, run_match  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data" / "match_001.json"

telemetry.init()
app = FastAPI(title="PitchMind")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
_team = None
league = League()
MATCHES: dict[str, dict] = {}  # match id -> {"match", "home", "away", "by", "done", "kits"}


def team():
    global _team
    if _team is None:
        _team = build_team()
    return _team


def guard(fn):
    try:
        return fn()
    except PermissionError as ex:
        raise HTTPException(401, str(ex))
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    except RuntimeError as ex:
        raise HTTPException(503, str(ex))


def _demo():
    return json.loads(DATA.read_text(encoding="utf-8"))


def get_match(mid: str | None) -> dict:
    if not mid:
        return _demo()
    if mid not in MATCHES:
        raise HTTPException(404, "Match not found. It may have expired, start a new one from your club.")
    return MATCHES[mid]["match"]


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def kits(home: dict, away: dict):
    a, b = home["colors"]["primary"], away["colors"]["primary"]
    if sum((x - y) ** 2 for x, y in zip(_rgb(a), _rgb(b))) < 90 ** 2:
        b = "#ff8a5b" if _rgb(a)[2] > 150 else "#5ac8fa"
    return {"home": a, "away": b}


# ---------------- match ----------------

@app.get("/api/health")
def health():
    return {"ok": True, "model": os.environ.get("FOUNDRY_MODEL", "gpt-4o"), "league": league.status(),
            "telemetry": bool(os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")), "events": bus.enabled()}


@app.get("/api/match")
def match(match: str | None = None):
    m = get_match(match)
    return {k: m[k] for k in ("match_id", "home", "away", "final_score", "note")} | {"events": len(m["events"])}


@app.get("/api/events")
def events(match: str | None = None):
    """Raw synthetic events for the 3D pitch replay. Ground truth, no AI."""
    m = get_match(match)
    keep = ("id", "minute", "second", "team", "player_id", "player", "type", "zone", "outcome", "xg")
    out = {"home": m["home"], "away": m["away"], "events": [{k: e[k] for k in keep} for e in m["events"]]}
    if match:
        info = MATCHES[match]
        out["kits"] = info["kits"]
        out["keepers"] = {s: m["squads"][s][0]["name"] for s in ("home", "away")}
        out["clubs"] = {"home": info["home"], "away": info["away"]}
    return out


@app.get("/api/stream")
async def stream(tone: str = "broadcast", speed: float = 0.0, match: str | None = None):
    """Replay the match. Each agent step arrives as one SSE message."""
    queue: asyncio.Queue = asyncio.Queue()
    m = get_match(match)

    async def emit(msg):
        await queue.put(msg)

    async def worker():
        try:
            await run_match(team(), m, tone, emit, speed)
            if match and match in MATCHES:
                await asyncio.to_thread(announce_full_time, match)
        except Exception as ex:
            await queue.put({"type": "error", "message": str(ex)[:300]})
        await queue.put(None)

    asyncio.create_task(worker())

    async def gen():
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=10)
            except asyncio.TimeoutError:
                # Keep alive so proxies do not drop a quiet stream, and the UI knows agents are still busy.
                yield 'data: {"type": "ping"}\n\n'
                continue
            if msg is None:
                break
            yield f"data: {json.dumps(msg)}\n\n"

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


@app.post("/api/fan")
async def fan(body: dict):
    """Fan Agent. Rewrite a note for a profile: kids, tactical, casual."""
    prompt = f"Profile: {body.get('profile', 'casual')}\nNote: {body['note']}"
    resp = await team()["fan"].run(prompt)
    return {"note": resp.text.strip()}


# ---------------- managers ----------------

@app.post("/api/auth/login")
def login(body: dict):
    u = guard(lambda: league.login(body.get("name", ""), body.get("avatar", "")))
    return {"user": u}


@app.get("/api/me")
def me(x_user: str = Header(default="")):
    u = guard(lambda: league.user(x_user))
    c = league.my_club(x_user)
    return {"user": u, "club": league.public(c, full=True) if c else None}


# ---------------- clubs ----------------

@app.post("/api/club/ai")
async def club_ai(body: dict):
    """Scout Agent builds a fictional club from the manager's idea. Falls back offline if Foundry is down."""
    idea = str(body.get("prompt", ""))[:400]
    style = str(body.get("style", ""))
    try:
        resp = await asyncio.wait_for(team()["scout"].run(f"Idea: {idea or 'surprise me'}\nPreferred style: {style or 'any'}"), timeout=45)
        return {"club": clean_club(_json(resp.text)), "by": "Scout Agent"}
    except Exception as ex:
        print(f"[Scout] fallback: {type(ex).__name__}: {str(ex)[:120]}", flush=True)
        return {"club": random_club(idea, style), "by": "offline builder"}


@app.post("/api/club")
def club_create(body: dict, x_user: str = Header(default="")):
    c = guard(lambda: league.create_club(x_user, body.get("club") or {}))
    return {"club": league.public(c, full=True)}


@app.put("/api/club")
def club_update(body: dict, x_user: str = Header(default="")):
    c = guard(lambda: league.update_squad(x_user, body.get("club") or {}))
    return {"club": league.public(c, full=True)}


@app.post("/api/club/join")
def club_join(body: dict, x_user: str = Header(default="")):
    c = guard(lambda: league.join(x_user, body.get("code", "")))
    return {"club": league.public(c, full=True)}


@app.post("/api/club/leave")
def club_leave(x_user: str = Header(default="")):
    guard(lambda: league.leave(x_user))
    return {"ok": True}


@app.get("/api/club/chat")
def club_chat(x_user: str = Header(default="")):
    c = guard(lambda: league.my_club(x_user))
    return {"chat": (c or {}).get("chat", [])[-50:]}


@app.post("/api/club/chat")
def club_say(body: dict, x_user: str = Header(default="")):
    c = guard(lambda: league.chat(x_user, body.get("text", "")))
    return {"chat": c["chat"][-50:]}


@app.get("/api/club/rivals")
def rivals(x_user: str = Header(default="")):
    c = guard(lambda: league.my_club(x_user))
    if not c:
        raise HTTPException(400, "Join a club first.")
    return {"rivals": league.rivals(c["id"])}


@app.get("/api/ladder")
def ladder():
    return {"clubs": guard(league.ladder)}


# ---------------- challenges ----------------

@app.post("/api/challenge")
def challenge(body: dict, x_user: str = Header(default="")):
    """Play my club against a rival. Builds a fresh synthetic match from both squads."""
    u = guard(lambda: league.user(x_user))
    mine = league.my_club(x_user)
    if not mine:
        raise HTTPException(400, "Join a club first.")
    opp = guard(lambda: league.club(body.get("opponent", "")))
    if opp["id"] == mine["id"]:
        raise HTTPException(400, "Pick another club.")
    seed = secrets.randbelow(10**9)
    m = play(mine, opp, seed)
    mid = secrets.token_hex(5)
    m["match_id"] = mid
    if len(MATCHES) > 60:
        MATCHES.pop(next(iter(MATCHES)))
    MATCHES[mid] = {"match": m, "home": mine["id"], "away": opp["id"], "by": u["name"], "done": None,
                    "kits": kits(mine, opp)}
    return {"match": mid, "home": mine["name"], "away": opp["name"]}


def settle(mid: str):
    """Apply a finished match to the ladder. Safe to call many times: trophies are applied once."""
    info = MATCHES.get(mid)
    if not info:
        raise HTTPException(404, "Match not found.")
    if not info["done"]:
        info["done"] = guard(lambda: league.record(info["home"], info["away"], info["match"]["final_score"], mid, info["by"]))
    return info["done"]


def announce_full_time(mid: str):
    """Full time reached on the server. Queue an event so the Azure Function settles the result.
    With no queue configured, settle right here instead. Either way it works if the page was closed."""
    with telemetry.span("match.full_time", **{"pitchmind.match_id": mid}) as sp:
        if bus.publish("match.completed", {"match_id": mid}):
            sp.set_attribute("pitchmind.settled_by", "azure-function")
            return
        sp.set_attribute("pitchmind.settled_by", "api")
        try:
            settle(mid)
        except Exception as ex:
            print(f"[Settle] {type(ex).__name__}: {str(ex)[:120]}", flush=True)


@app.post("/api/challenge/{mid}/finish")
def finish(mid: str):
    """Settles the match. Called by the Azure Function, or by the page at full time. Applies trophies once."""
    return {"result": settle(mid)}
