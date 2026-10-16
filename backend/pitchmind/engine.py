"""Match engine for user clubs. Same event model as datagen/generate_match.py,
but the two squads, their ratings and their play style shape the match.

Everything is synthetic. Clubs and players are invented by the manager or the Scout Agent.
"""
import random

ZONES = ["own_third", "middle_third", "final_third", "box"]
POS_ORDER = ["GK", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "FW", "FW", "FW"]

# How each style tilts the event mix: pass, tackle, turnover, pressure, shot, foul.
STYLE_MIX = {
    "possession": [0.65, 0.10, 0.08, 0.08, 0.055, 0.035],
    "press":      [0.50, 0.15, 0.09, 0.16, 0.06, 0.04],
    "counter":    [0.49, 0.15, 0.11, 0.10, 0.08, 0.07],
    "direct":     [0.52, 0.12, 0.12, 0.10, 0.075, 0.065],
}
PASS_OK = {"possession": 0.88, "press": 0.80, "counter": 0.79, "direct": 0.74}


def power(club: dict) -> int:
    ps = club["players"]
    return round(sum(p["rating"] for p in ps) / len(ps))


def _unit(club: dict, pos: str) -> float:
    xs = [p["rating"] for p in club["players"] if p["pos"] == pos] or [70]
    return sum(xs) / len(xs)


def play(home: dict, away: dict, seed: int) -> dict:
    """Return a match dict in the exact shape the agents and the 3D pitch expect."""
    rng = random.Random(seed)
    H, A = home["name"], away["name"]
    squads = {}
    for side, club, pre in (("home", home, "H"), ("away", away, "A")):
        squads[side] = [
            {"id": f"{pre}{i + 1}", "name": p["name"], "pos": p["pos"], "rating": p["rating"]}
            for i, p in enumerate(club["players"])
        ]

    # Midfield and overall quality decide who sees more of the ball.
    edge = (_unit(home, "MF") - _unit(away, "MF")) * 0.004 + (power(home) - power(away)) * 0.003
    base_share = max(0.32, min(0.68, 0.51 + edge))  # small home advantage
    # Momentum phases make storylines the Analyst can find.
    swings = [rng.uniform(-0.08, 0.08) for _ in range(7)]

    def share(minute):
        return max(0.25, min(0.75, base_share + swings[min(6, minute // 14)]))

    def finish(club, opp):
        att = _unit(club, "FW")
        gk = next((p["rating"] for p in opp["players"] if p["pos"] == "GK"), 70)
        return max(0.7, min(1.4, 1 + (att - gk) * 0.018))

    def pick(squad, weights):
        pool = [p for p in squad if p["pos"] != "GK"]
        w = [weights.get(p["pos"], 1) * (p["rating"] / 75) ** 2 for p in pool]
        return rng.choices(pool, weights=w, k=1)[0]

    events, score, eid = [], {H: 0, A: 0}, 1
    for minute in range(0, 95):
        for _ in range(rng.randint(2, 5)):
            is_home = rng.random() < share(minute)
            club, opp = (home, away) if is_home else (away, home)
            team = club["name"]
            squad = squads["home" if is_home else "away"]
            style = club.get("style", "possession")
            mix = STYLE_MIX.get(style, STYLE_MIX["possession"])
            r, acc = rng.random(), 0.0
            kind = 5
            for i, w in enumerate(mix):
                acc += w
                if r < acc:
                    kind = i
                    break
            sec = rng.randint(0, 59)
            xg, detail = 0.0, {}
            if kind == 0:
                p = pick(squad, {"DF": 2, "MF": 4, "FW": 2})
                typ, zone = "pass", rng.choice(ZONES)
                out = "complete" if rng.random() < PASS_OK.get(style, 0.82) else "incomplete"
            elif kind == 1:
                p = pick(squad, {"DF": 3, "MF": 3, "FW": 1})
                typ, zone = "tackle", rng.choice(ZONES[:3])
                out = "won" if rng.random() < 0.45 + (p["rating"] - 70) * 0.01 else "lost"
            elif kind == 2:
                p = pick(squad, {"DF": 1, "MF": 2, "FW": 3})
                typ, zone, out = "possession_change", rng.choice(ZONES), "turnover"
            elif kind == 3:
                p = pick(squad, {"DF": 1, "MF": 2, "FW": 3})
                typ, zone, out = "pressure", rng.choice(ZONES[1:]), "applied"
            elif kind == 4:
                p = pick(squad, {"DF": 0.5, "MF": 2, "FW": 5})
                xg = round(rng.choice([0.03, 0.05, 0.08, 0.12, 0.2, 0.35, 0.6]), 2)
                roll = rng.random()
                if roll < xg * 0.62 * finish(club, opp):
                    out = "goal"
                    score[team] += 1
                elif roll < 0.5:
                    out = "saved"
                elif roll < 0.8:
                    out = "off_target"
                else:
                    out = "blocked"
                typ, zone = "shot", "box" if xg >= 0.12 else "final_third"
                detail = {"score_after": dict(score)}
            else:
                p = pick(squad, {"DF": 4, "MF": 3, "FW": 1})
                typ, zone, out = "foul", rng.choice(ZONES[:3]), "free_kick"
            events.append({"id": eid, "minute": minute, "second": sec, "team": team, "player_id": p["id"],
                           "player": p["name"], "type": typ, "zone": zone, "outcome": out, "xg": xg, "detail": detail})
            eid += 1

    events.sort(key=lambda e: (e["minute"], e["second"]))
    for i, e in enumerate(events, start=1):
        e["id"] = i
    return {
        "match_id": f"club-{seed}",
        "home": H,
        "away": A,
        "note": "Synthetic data. Clubs and players are fictional.",
        "final_score": score,
        "squads": squads,
        "events": events,
    }
