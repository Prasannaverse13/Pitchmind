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


async def _ask(agent, prompt, state, label, tries=3):
    last = None
    for attempt in range(1, tries + 1):
        try:
            resp = await agent.run(prompt)
            return resp.text
        except Exception as ex:  # recovery path
            last = ex
            state.log.append({"agent": label, "event": "retry", "attempt": attempt, "error": str(ex)[:160]})
            await asyncio.sleep(1.5 * attempt)
    state.log.append({"agent": label, "event": "failed", "error": str(last)[:160]})
    raise last


async def run_window(team, state: MatchState, start: int, end: int, tone: str, emit):
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
            claims = _json(await _ask(team["analyst"], base + feedback, state, "Analyst"))["insights"]
        except Exception:
            state.log.append({"agent": "Lead", "event": "skip_window", "window": [start, end]})
            await emit({"type": "recovery", "note": f"Analyst failed for {start}-{end}. Window skipped."})
            return
        await emit({"type": "handoff", "from": "Analyst", "to": "Proof", "claims": len(claims)})
        proof_prompt = (f"Claims: {json.dumps(claims)}\nStats: {json.dumps(truth)}\n"
                        f"Events:\n{S.compact_events(events)}")
        try:
            results = _json(await _ask(team["proof"], proof_prompt, state, "Proof"))["results"]
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
        if verified or not bad:
            break
        feedback = "\nProof rejected your claims: " + json.dumps(bad) + "\nTry again with correct numbers."
        await emit({"type": "recovery", "note": f"Proof rejected {len(bad)} claim(s). Analyst retrying."})

    for ins in verified:
        await emit({"type": "handoff", "from": "Proof", "to": "Story"})
        try:
            note = (await _ask(team["story"], f"Tone: {tone}\nInsight: {json.dumps(ins)}", state, "Story")).strip()
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
        state.recap = _json(await _ask(team["recap"], prompt, state, "Recap"))
    except Exception:
        state.recap = {"headline": f"{state.match['home']} {state.match['final_score']}",
                       "summary": "Recap agent unavailable. Showing verified insights only.",
                       "turning_points": [], "voiceover": ""}
    await emit({"type": "recap", "recap": state.recap})


async def run_match(team, match: dict, tone: str, emit, speed: float = 0.0):
    """Replay a match window by window. speed is seconds to pause between windows."""
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
