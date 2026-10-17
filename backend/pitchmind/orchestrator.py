"""Lead orchestrator. Hands work between agents using shared match state.

Flow per window:  Analyst -> Proof -> (rejected? back to Analyst with feedback) -> Story
At full time:     Recap Agent writes the report from verified insights only.
Failures: each call retries, then degrades to a safe fallback and logs a note.
"""
import asyncio
import json
import re
from dataclasses import dataclass, field

from . import stats as S
from .telemetry import event, span

WINDOW = 10
MAX_ANALYST_TRIES = 2


@dataclass
class MatchState:
    match: dict
    insights: list = field(default_factory=list)   # verified insights with notes
    rejected: list = field(default_factory=list)   # claims Proof refused
    log: list = field(default_factory=list)        # trace of handoffs and recoveries
    recap: dict | None = None


def _json(text: str):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no json in reply")
    return json.loads(m.group(0))


CALL_TIMEOUT = 40


async def _ask(agent, prompt, state, label, tries=3, emit=None):
    last = None
    for attempt in range(1, tries + 1):
        try:
            with span(f"agent.{label.lower()}", **{"pitchmind.agent": label, "pitchmind.attempt": attempt,
                                                    "gen_ai.operation.name": "invoke_agent",
                                                    "pitchmind.prompt_chars": len(prompt)}) as sp:
                resp = await asyncio.wait_for(agent.run(prompt), timeout=CALL_TIMEOUT)
                sp.set_attribute("pitchmind.reply_chars", len(resp.text or ""))
                return resp.text
        except Exception as ex:  # recovery path
            last = ex
            msg = f"{type(ex).__name__}: {str(ex)[:140]}"
            print(f"[{label}] attempt {attempt} failed: {msg}", flush=True)
            state.log.append({"agent": label, "event": "retry", "attempt": attempt, "error": msg})
            if emit:
                await emit({"type": "recovery", "note": f"{label} attempt {attempt} failed: {msg}"})
            await asyncio.sleep(2.0 * attempt)
    state.log.append({"agent": label, "event": "failed", "error": str(last)[:160]})
    raise last


async def run_window(team, state: MatchState, start: int, end: int, tone: str, emit):
    with span("match.window", **{"pitchmind.match_id": state.match.get("match_id"), "pitchmind.window_start": start, "pitchmind.window_end": end}):
        await _run_window(team, state, start, end, tone, emit)


async def _run_window(team, state: MatchState, start: int, end: int, tone: str, emit):
    events = S.window_events(state.match["events"], start, end)
    if not events:
        return
    truth = S.team_stats(events)
    score = S.score_at(state.match["events"], end)
    await emit({"type": "window", "minute": end, "score": score})
    base = (f"Window {start}-{end} minutes. Score: {score}\n"
            f"Stats: {json.dumps(truth)}\nEvents:\n{S.compact_events(events)}")
    feedback = ""
    verified = []
    for attempt in range(1, MAX_ANALYST_TRIES + 1):
        await emit({"type": "handoff", "from": "Lead", "to": "Analyst", "window": [start, end]})
        try:
            claims = _json(await _ask(team["analyst"], base + feedback, state, "Analyst", emit=emit))["insights"]
        except Exception:
            state.log.append({"agent": "Lead", "event": "skip_window", "window": [start, end]})
            await emit({"type": "recovery", "note": f"Analyst failed for {start}-{end}. Window skipped."})
            return
        await emit({"type": "handoff", "from": "Analyst", "to": "Proof", "claims": len(claims)})
        proof_prompt = (f"Claims: {json.dumps(claims)}\nStats: {json.dumps(truth)}\n"
                        f"Events:\n{S.compact_events(events)}")
        try:
            results = _json(await _ask(team["proof"], proof_prompt, state, "Proof", emit=emit))["results"]
        except Exception:
            results = [{"index": i, "verdict": "rejected", "reason": "proof unavailable"} for i in range(len(claims))]
        bad = []
        for r in results:
            i = r["index"]
            if i >= len(claims):
                continue
            if r["verdict"] == "verified":
                verified.append({**claims[i], "proof": r["reason"]})
            else:
                bad.append({**claims[i], "reason": r["reason"]})
        state.rejected += bad
        with span("proof.verdict", **{"pitchmind.claims": len(claims), "pitchmind.verified": len(claims) - len(bad), "pitchmind.rejected": len(bad), "pitchmind.window_end": end}) as sp:
            for b in bad:
                sp.add_event("claim_rejected", {"reason": str(b.get("reason", ""))[:200], "metric": str(b.get("metric", ""))})
        if verified or not bad:
            break
        feedback = "\nProof rejected your claims: " + json.dumps(bad) + "\nTry again with correct numbers."
        await emit({"type": "recovery", "note": f"Proof rejected {len(bad)} claim(s). Analyst retrying."})

    for ins in verified:
        await emit({"type": "handoff", "from": "Proof", "to": "Story"})
        try:
            note = (await _ask(team["story"], f"Tone: {tone}\nInsight: {json.dumps(ins)}", state, "Story", emit=emit)).strip()
        except Exception:
            note = ins["claim"]
        ins["note"] = note
        ins["window"] = [start, end]
        state.insights.append(ins)
        await emit({"type": "insight", "insight": ins})


async def run_recap(team, state: MatchState, emit):
    await emit({"type": "handoff", "from": "Lead", "to": "Recap"})
    final = S.team_stats(state.match["events"])
    prompt = (f"Teams: {state.match['home']} vs {state.match['away']}\n"
              f"Final score: {state.match['final_score']}\nFinal stats: {json.dumps(final)}\n"
              f"Verified insights: {json.dumps(state.insights)}")
    try:
        state.recap = _json(await _ask(team["recap"], prompt, state, "Recap", emit=emit))
    except Exception:
        state.recap = {"headline": f"{state.match['home']} {state.match['final_score']}",
                       "summary": "Recap agent unavailable. Showing verified insights only.",
                       "turning_points": [], "voiceover": ""}
    await emit({"type": "recap", "recap": state.recap})


async def run_match(team, match: dict, tone: str, emit, speed: float = 0.0):
    """Replay a match window by window. speed is seconds to pause between windows."""
    async def traced(msg):
        t = msg.get("type")
        if t == "handoff":
            event("handoff", **{"from": msg.get("from"), "to": msg.get("to"), "claims": msg.get("claims")})
        elif t == "recovery":
            event("recovery", note=str(msg.get("note"))[:200])
        elif t == "insight":
            event("note_on_air", minute=msg["insight"].get("minute"), metric=msg["insight"].get("metric"))
        await emit(msg)

    with span("match.run", **{"pitchmind.match_id": match.get("match_id"), "pitchmind.home": match.get("home"), "pitchmind.away": match.get("away"), "pitchmind.tone": tone}) as sp:
        state = await _run_match(team, match, tone, traced, speed)
        sp.set_attribute("pitchmind.verified", len(state.insights))
        sp.set_attribute("pitchmind.rejected", len(state.rejected))
        return state


async def _run_match(team, match: dict, tone: str, emit, speed: float = 0.0):
    state = MatchState(match=match)
    last = max(e["minute"] for e in match["events"])
    for start in range(0, last + 1, WINDOW):
        await run_window(team, state, start, min(start + WINDOW - 1, last), tone, emit)
        if speed:
            await asyncio.sleep(speed)
    await run_recap(team, state, emit)
    await emit({"type": "done", "log": state.log, "rejected": len(state.rejected),
                "verified": len(state.insights)})
    return state
