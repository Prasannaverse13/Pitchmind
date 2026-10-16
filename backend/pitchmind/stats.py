"""Ground truth stats computed straight from raw events.

The Proof Agent checks every claim against these numbers. Nothing here uses AI.
"""
from collections import defaultdict


def window_events(events, start_min, end_min):
    return [e for e in events if start_min <= e["minute"] <= end_min]


def team_stats(events):
    """Per team stats for a list of events."""
    out = defaultdict(lambda: {
        "passes": 0, "passes_complete": 0, "shots": 0, "shots_on_target": 0,
        "xg": 0.0, "goals": 0, "tackles": 0, "tackles_won": 0,
        "pressures": 0, "turnovers": 0, "fouls": 0, "final_third_actions": 0,
    })
    for e in events:
        s = out[e["team"]]
        t = e["type"]
        if t == "pass":
            s["passes"] += 1
            s["passes_complete"] += e["outcome"] == "complete"
        elif t == "shot":
            s["shots"] += 1
            s["xg"] = round(s["xg"] + e["xg"], 2)
            s["shots_on_target"] += e["outcome"] in ("goal", "saved")
            s["goals"] += e["outcome"] == "goal"
        elif t == "tackle":
            s["tackles"] += 1
            s["tackles_won"] += e["outcome"] == "won"
        elif t == "pressure":
            s["pressures"] += 1
        elif t == "possession_change":
            s["turnovers"] += 1
        elif t == "foul":
            s["fouls"] += 1
        if e["zone"] in ("final_third", "box"):
            s["final_third_actions"] += 1
    for s in out.values():
        s["pass_accuracy"] = round(100 * s["passes_complete"] / s["passes"], 1) if s["passes"] else 0.0
    return dict(out)


def compact_events(events):
    """Short lines the model can read cheaply. Each line starts with the event id."""
    lines = []
    for e in events:
        extra = f" xG {e['xg']}" if e["type"] == "shot" else ""
        lines.append(
            f"#{e['id']} {e['minute']}'{e['second']:02d} {e['team']} {e['player']} "
            f"{e['type']} {e['zone']} {e['outcome']}{extra}"
        )
    return "\n".join(lines)


def score_at(events, minute):
    score = {}
    for e in events:
        if e["minute"] > minute:
            break
        score.setdefault(e["team"], 0)
        if e["type"] == "shot" and e["outcome"] == "goal":
            score[e["team"]] += 1
    return score
