"""PitchMind synthetic match generator.

Produces a football realistic event stream for a fictional match.
No real Premier League data is used. Teams and players are invented.

Usage:
    python generate_match.py --seed 7 --out ../data/match_001.json
"""
import argparse
import json
import random
from dataclasses import dataclass, asdict, field

HOME = "Northbridge Rovers"
AWAY = "Eastvale United"

HOME_PLAYERS = [
    ("H1", "Tomas Rennick", "GK"), ("H2", "Daniel Okafor", "DF"),
    ("H3", "Liam Hartley", "DF"), ("H4", "Marco Silveira", "DF"),
    ("H5", "Jonas Brandt", "DF"), ("H6", "Kai Moreno", "MF"),
    ("H7", "Ravi Anand", "MF"), ("H8", "Elias Ward", "MF"),
    ("H9", "Theo Marchetti", "FW"), ("H10", "Sami Durrani", "FW"),
    ("H11", "Callum Pryce", "FW"),
]
AWAY_PLAYERS = [
    ("A1", "Viktor Lang", "GK"), ("A2", "Owen Barrett", "DF"),
    ("A3", "Nico Alvarez", "DF"), ("A4", "Hugo Larsen", "DF"),
    ("A5", "Femi Adeyemi", "DF"), ("A6", "Jack Thorne", "MF"),
    ("A7", "Mateo Ruiz", "MF"), ("A8", "Isaac Bell", "MF"),
    ("A9", "Leon Vogel", "FW"), ("A10", "Ezra Cole", "FW"),
    ("A11", "Dario Conte", "FW"),
]

ZONES = ["own_third", "middle_third", "final_third", "box"]


@dataclass
class Event:
    id: int
    minute: int
    second: int
    team: str
    player_id: str
    player: str
    type: str
    zone: str
    outcome: str
    xg: float = 0.0
    detail: dict = field(default_factory=dict)


def pick(players, role_weights):
    pool = [p for p in players if p[2] != "GK"]
    weights = [role_weights.get(p[2], 1) for p in pool]
    return random.choices(pool, weights=weights, k=1)[0]


def generate(seed: int = 7) -> dict:
    random.seed(seed)
    events = []
    eid = 1
    score = {HOME: 0, AWAY: 0}
    # Momentum shifts create storylines the agents can detect.
    # A late pressing spell for one side makes for a good demo.
    pressure_phases = [
        (0, 14, 0.50), (15, 29, 0.46), (30, 44, 0.56),
        (45, 59, 0.44), (60, 74, 0.38), (75, 94, 0.62),
    ]

    def home_share(minute):
        for a, b, share in pressure_phases:
            if a <= minute <= b:
                return share
        return 0.5

    for minute in range(0, 95):
        if minute > 90 and minute < 94 and random.random() < 0.3:
            pass
        n = random.randint(2, 5)
        for _ in range(n):
            is_home = random.random() < home_share(minute)
            team = HOME if is_home else AWAY
            players = HOME_PLAYERS if is_home else AWAY_PLAYERS
            r = random.random()
            second = random.randint(0, 59)
            if r < 0.55:
                p = pick(players, {"DF": 2, "MF": 4, "FW": 2})
                ok = random.random() < 0.82
                ev = Event(eid, minute, second, team, p[0], p[1], "pass",
                           random.choice(ZONES), "complete" if ok else "incomplete")
            elif r < 0.68:
                p = pick(players, {"DF": 1, "MF": 3, "FW": 1})
                ok = random.random() < 0.55
                ev = Event(eid, minute, second, team, p[0], p[1], "tackle",
                           random.choice(ZONES[:3]), "won" if ok else "lost")
            elif r < 0.78:
                p = pick(players, {"DF": 1, "MF": 2, "FW": 3})
                ev = Event(eid, minute, second, team, p[0], p[1], "possession_change",
                           random.choice(ZONES), "turnover")
            elif r < 0.90:
                p = pick(players, {"DF": 1, "MF": 2, "FW": 3})
                ev = Event(eid, minute, second, team, p[0], p[1], "pressure",
                           random.choice(ZONES[1:]), "applied")
            elif r < 0.97:
                p = pick(players, {"DF": 0.5, "MF": 2, "FW": 5})
                xg = round(random.choice([0.03, 0.05, 0.08, 0.12, 0.2, 0.35, 0.6]), 2)
                roll = random.random()
                if roll < xg * 1.1:
                    outcome = "goal"
                    score[team] += 1
                elif roll < 0.5:
                    outcome = "saved"
                elif roll < 0.8:
                    outcome = "off_target"
                else:
                    outcome = "blocked"
                ev = Event(eid, minute, second, team, p[0], p[1], "shot",
                           "box" if xg >= 0.12 else "final_third", outcome, xg,
                           {"score_after": dict(score)})
            else:
                p = pick(players, {"DF": 4, "MF": 3, "FW": 1})
                ev = Event(eid, minute, second, team, p[0], p[1], "foul",
                           random.choice(ZONES[:3]), "free_kick")
            events.append(ev)
            eid += 1

    events.sort(key=lambda e: (e.minute, e.second))
    for i, e in enumerate(events, start=1):
        e.id = i

    return {
        "match_id": f"synthetic-{seed}",
        "home": HOME,
        "away": AWAY,
        "note": "Synthetic data. Teams and players are fictional.",
        "final_score": score,
        "events": [asdict(e) for e in events],
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="../data/match_001.json")
    args = ap.parse_args()
    data = generate(args.seed)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"{len(data['events'])} events, final score {data['final_score']}")
