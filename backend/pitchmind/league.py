"""The PitchMind league: managers, clubs, invite codes, trophies, chat and match history.

Stored in Azure Cosmos DB when COSMOS_ENDPOINT is set, otherwise in a local JSON file (see store.py).
All clubs and players are fictional.
"""
import json
import os
import random
import re
import secrets
import threading
import time
from .engine import POS_ORDER, power
from .store import make_store

_lock = threading.Lock()

STYLES = ["possession", "press", "counter", "direct"]
REAL_CLUBS = re.compile(
    r"arsenal|chelsea|liverpool|manchester|man city|man utd|tottenham|spurs|everton|newcastle|aston villa|"
    r"west ham|brighton|wolves|wolverhampton|fulham|brentford|crystal palace|bournemouth|nottingham|forest|"
    r"leicester|leeds|burnley|sunderland|ipswich|southampton|barcelona|real madrid|bayern|juventus|psg", re.I)

FIRST = ["Theo", "Kai", "Ravi", "Elias", "Jonas", "Marco", "Leon", "Ezra", "Nico", "Hugo", "Femi", "Owen", "Mateo",
         "Isaac", "Dario", "Viktor", "Sami", "Callum", "Arjun", "Luca", "Omar", "Felix", "Tariq", "Bruno", "Yusuf",
         "Milo", "Rafael", "Jasper", "Kenji", "Anders", "Tobi", "Zane", "Idris", "Mason", "Emil", "Rio", "Dev"]
LAST = ["Rennick", "Okafor", "Hartley", "Silveira", "Brandt", "Moreno", "Anand", "Ward", "Marchetti", "Durrani",
        "Pryce", "Lang", "Barrett", "Alvarez", "Larsen", "Adeyemi", "Thorne", "Ruiz", "Bell", "Vogel", "Cole",
        "Nakamura", "Osei", "Kovac", "Lindqvist", "Mensah", "Varga", "Castillo", "Iyer", "Hale", "Quinn", "Sato"]
TRAITS = {"GK": ["Shot stopper", "Sweeper keeper", "Commanding"], "DF": ["Rock solid", "Ball player", "Quick recovery", "Aerial threat"],
          "MF": ["Playmaker", "Engine", "Ball winner", "Tempo setter"], "FW": ["Poacher", "Speedster", "Target man", "Clinical"]}

BOTS = [
    ("Northbridge Rovers", "NBR", "#5ac8fa", "#0b2a3a", "possession", 78, 640),
    ("Eastvale United", "EVU", "#ff8a5b", "#3a160b", "press", 77, 610),
    ("Harbour City Wanderers", "HCW", "#ffd166", "#2a2205", "counter", 74, 520),
    ("Redmoor Athletic", "RMA", "#ef476f", "#330a16", "direct", 72, 470),
    ("Silverpine FC", "SPF", "#c0d6df", "#1b2a30", "possession", 70, 410),
    ("Ashford Comets", "ASC", "#b28cff", "#1f1236", "press", 68, 350),
    ("Kestrel Bay", "KBY", "#06d6a0", "#03291f", "counter", 66, 300),
    ("Ironvale Town", "IVT", "#adb5bd", "#1d2125", "direct", 63, 240),
]


def _now():
    return int(time.time())


def squad(rng: random.Random, level: int) -> list:
    used, out = set(), []
    for pos in POS_ORDER:
        while True:
            n = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
            if n not in used:
                used.add(n)
                break
        out.append({"name": n, "pos": pos, "rating": max(55, min(92, level + rng.randint(-6, 6))),
                    "trait": rng.choice(TRAITS[pos])})
    return out


def _hex(c, fallback):
    return c if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c) else fallback


def clean_club(raw: dict, seed: int = 0) -> dict:
    """Make any AI or user draft safe: 11 players in 4-3-3 order, fictional names, sane ratings."""
    rng = random.Random(seed or secrets.randbits(32))
    name = str(raw.get("name") or "").strip()[:32] or f"{rng.choice(LAST)} {rng.choice(['FC', 'Athletic', 'Rovers', 'United'])}"
    if REAL_CLUBS.search(name):
        name = f"{rng.choice(LAST)} Athletic"
    short = re.sub(r"[^A-Z]", "", str(raw.get("short") or "").upper())[:3] or "".join(w[0] for w in name.upper().split())[:3]
    short = (short + "XXX")[:3]
    colors = raw.get("colors") or {}
    style = raw.get("style") if raw.get("style") in STYLES else rng.choice(STYLES)
    by_pos = {k: [] for k in ("GK", "DF", "MF", "FW")}
    for p in raw.get("players") or []:
        pos = str(p.get("pos", "")).upper()[:2]
        if pos in by_pos and p.get("name"):
            nm = str(p["name"]).strip()[:28]
            try:
                rt = int(p.get("rating", 72))
            except Exception:
                rt = 72
            by_pos[pos].append({"name": nm, "pos": pos, "rating": max(50, min(92, rt)),
                                "trait": str(p.get("trait") or rng.choice(TRAITS[pos]))[:24]})
    filler = squad(rng, 70)
    players = []
    for i, pos in enumerate(POS_ORDER):
        players.append(by_pos[pos].pop(0) if by_pos[pos] else filler[i])
    return {
        "name": name, "short": short,
        "motto": str(raw.get("motto") or "One club. One voice.")[:60],
        "city": str(raw.get("city") or "")[:28],
        "colors": {"primary": _hex(colors.get("primary"), "#3ddc84"), "secondary": _hex(colors.get("secondary"), "#0a1612")},
        "style": style, "players": players,
    }


def random_club(prompt: str = "", style: str = "") -> dict:
    """Offline builder, used when the Scout Agent is unavailable."""
    rng = random.Random(hash(prompt + style) & 0xFFFFFFFF or 1)
    words = [w.capitalize() for w in re.findall(r"[a-zA-Z]{4,}", prompt)][:2]
    stem = words[0] if words else rng.choice(LAST)
    pal = rng.choice([("#ffd166", "#2a2205"), ("#ef476f", "#330a16"), ("#06d6a0", "#03291f"), ("#4d6bff", "#0b1340"), ("#b28cff", "#1f1236")])
    return clean_club({"name": f"{stem} {rng.choice(['FC', 'Athletic', 'Rovers', 'Comets', 'Town'])}",
                       "motto": "Built by AI. Finished by us.", "colors": {"primary": pal[0], "secondary": pal[1]},
                       "style": style if style in STYLES else rng.choice(STYLES), "players": squad(rng, 72)}, seed=rng.randint(1, 10**9))


class League:
    def __init__(self):
        self.db = {"users": {}, "clubs": {}}
        self.ready = False
        self.error = ""
        self._tried = 0.0
        try:
            self.store = make_store()
            self._ensure(force=True)
        except Exception as ex:  # keep the API up; storage retries on the next request
            self.store = getattr(self, "store", None)
            if not self.error:
                self.error = f"{type(ex).__name__}: {str(ex)[:200]}"

    def _ensure(self, force=False):
        """Load the league once. A fresh role assignment can take a few minutes, so retry gently."""
        if self.ready:
            return
        if not force and time.time() - self._tried < 8:
            raise RuntimeError("The league is warming up. Try again in a few seconds.")
        self._tried = time.time()
        if self.store is None:
            self.store = make_store()
        with _lock:
            try:
                self.db = self.store.load()
                self._seed_bots()
                self.store.save(self.db)
                self.ready, self.error = True, ""
                print(f"[League] {self.store.kind} store ready: {len(self.db['users'])} managers, {len(self.db['clubs'])} clubs", flush=True)
            except Exception as ex:
                self.error = f"{type(ex).__name__}: {str(ex)[:200]}"
                print(f"[League] storage not ready: {self.error}", flush=True)
                raise RuntimeError("The league is warming up. Try again in a few seconds.")

    def status(self) -> dict:
        return {"store": getattr(self.store, "kind", "none"), "ready": self.ready, "error": self.error or None}

    # ---------- internal ----------
    def _seed_bots(self):
        for i, (name, short, c1, c2, style, lvl, trophies) in enumerate(BOTS):
            cid = f"bot{i + 1}"
            if cid in self.db["clubs"]:
                continue
            rng = random.Random(1000 + i)
            self.db["clubs"][cid] = {
                "id": cid, "bot": True, "name": name, "short": short, "motto": "League regulars.", "city": "",
                "colors": {"primary": c1, "secondary": c2}, "style": style, "players": squad(rng, lvl),
                "trophies": trophies, "wins": 0, "draws": 0, "losses": 0, "xp": 0, "members": [], "owner": None,
                "code": None, "chat": [], "history": [], "created": _now(),
            }

    def _write(self):
        self.store.save(self.db)

    def public(self, club: dict, full=False) -> dict:
        keys = ["id", "name", "short", "motto", "city", "colors", "style", "trophies", "wins", "draws", "losses", "bot"]
        out = {k: club.get(k) for k in keys}
        out["power"] = power(club)
        out["level"] = 1 + club.get("xp", 0) // 100
        out["members"] = len(club.get("members", []))
        if full:
            out["players"] = club["players"]
            out["code"] = club.get("code")
            out["owner"] = club.get("owner")
            out["xp"] = club.get("xp", 0)
            out["roster"] = [{"id": u, "name": self.db["users"].get(u, {}).get("name", "?"),
                              "avatar": self.db["users"].get(u, {}).get("avatar", "#3ddc84"),
                              "role": "Owner" if u == club.get("owner") else "Member"} for u in club.get("members", [])]
            out["history"] = club.get("history", [])[-12:][::-1]
        return out

    # ---------- managers ----------
    def login(self, name: str, avatar: str) -> dict:
        self._ensure()
        name = re.sub(r"\s+", " ", name or "").strip()[:24]
        if len(name) < 2:
            raise ValueError("Pick a manager name with at least 2 letters.")
        with _lock:
            for u in self.db["users"].values():
                if u["name"].lower() == name.lower():
                    u["avatar"] = _hex(avatar, u.get("avatar", "#3ddc84"))
                    self._write()
                    return u
            uid = "u" + secrets.token_hex(6)
            u = {"id": uid, "name": name, "avatar": _hex(avatar, "#3ddc84"), "club": None, "created": _now()}
            self.db["users"][uid] = u
            self._write()
            return u

    def user(self, uid: str) -> dict:
        self._ensure()
        u = self.db["users"].get(uid or "")
        if not u:
            raise PermissionError("Please sign in again.")
        return u

    # ---------- clubs ----------
    def create_club(self, uid: str, draft: dict) -> dict:
        u = self.user(uid)
        club = clean_club(draft)
        with _lock:
            if u.get("club") and u["club"] in self.db["clubs"]:
                self._leave(u)
            cid = "c" + secrets.token_hex(5)
            code = secrets.token_hex(3).upper()
            club.update({"id": cid, "bot": False, "trophies": 100, "wins": 0, "draws": 0, "losses": 0, "xp": 0,
                         "members": [uid], "owner": uid, "code": code, "chat": [], "history": [], "created": _now()})
            club["chat"].append({"by": "Scout", "text": f"{club['name']} is born. Share code {code} to bring your mates in.", "t": _now(), "bot": True})
            self.db["clubs"][cid] = club
            u["club"] = cid
            self._write()
            return club

    def join(self, uid: str, code: str) -> dict:
        u = self.user(uid)
        code = (code or "").strip().upper()
        with _lock:
            club = next((c for c in self.db["clubs"].values() if c.get("code") == code), None)
            if not club:
                raise ValueError("No club with that code.")
            if len(club["members"]) >= 30:
                raise ValueError("That club is full.")
            if u.get("club") and u["club"] != club["id"]:
                self._leave(u)
            if uid not in club["members"]:
                club["members"].append(uid)
                club["chat"].append({"by": "Scout", "text": f"{u['name']} joined the club.", "t": _now(), "bot": True})
            u["club"] = club["id"]
            self._write()
            return club

    def _leave(self, u):
        club = self.db["clubs"].get(u.get("club") or "")
        if club and u["id"] in club["members"]:
            club["members"].remove(u["id"])
            club["chat"].append({"by": "Scout", "text": f"{u['name']} left the club.", "t": _now(), "bot": True})
            if club["owner"] == u["id"]:
                club["owner"] = club["members"][0] if club["members"] else None
            if not club["members"]:
                self.db["clubs"].pop(club["id"], None)
        u["club"] = None

    def leave(self, uid: str):
        u = self.user(uid)
        with _lock:
            self._leave(u)
            self._write()

    def my_club(self, uid: str):
        u = self.user(uid)
        return self.db["clubs"].get(u.get("club") or "")

    def club(self, cid: str) -> dict:
        self._ensure()
        c = self.db["clubs"].get(cid)
        if not c:
            raise ValueError("Club not found.")
        return c

    def update_squad(self, uid: str, draft: dict) -> dict:
        club = self.my_club(uid)
        if not club or club["owner"] != uid:
            raise PermissionError("Only the owner can change the club.")
        clean = clean_club({**club, **draft})
        with _lock:
            for k in ("name", "short", "motto", "city", "colors", "style", "players"):
                club[k] = clean[k]
            self._write()
        return club

    def chat(self, uid: str, text: str) -> dict:
        u = self.user(uid)
        club = self.my_club(uid)
        if not club:
            raise ValueError("Join a club first.")
        text = re.sub(r"\s+", " ", text or "").strip()[:240]
        if not text:
            raise ValueError("Empty message.")
        with _lock:
            club["chat"] = (club["chat"] + [{"by": u["name"], "avatar": u["avatar"], "text": text, "t": _now()}])[-80:]
            self._write()
        return club

    def ladder(self) -> list:
        self._ensure()
        cs = sorted(self.db["clubs"].values(), key=lambda c: -c.get("trophies", 0))
        return [self.public(c) for c in cs[:50]]

    def rivals(self, cid: str) -> list:
        me = self.db["clubs"][cid]
        cs = [c for c in self.db["clubs"].values() if c["id"] != cid]
        cs.sort(key=lambda c: abs(c.get("trophies", 0) - me.get("trophies", 0)))
        return [self.public(c) for c in cs[:8]]

    def record(self, home_id: str, away_id: str, score: dict, match_id: str, by: str):
        """Apply a finished match once. Win +30, draw +8, loss -18 trophies."""
        self._ensure()
        with _lock:
            h, a = self.db["clubs"].get(home_id), self.db["clubs"].get(away_id)
            if not h or not a:
                return None
            if any(x.get("match") == match_id for x in h.get("history", [])):
                return next(x for x in h["history"] if x.get("match") == match_id)
            hg, ag = score[h["name"]], score[a["name"]]
            res = {}
            for club, opp, gf, ga in ((h, a, hg, ag), (a, h, ag, hg)):
                r = "W" if gf > ga else "D" if gf == ga else "L"
                delta = {"W": 30, "D": 8, "L": -18}[r]
                club["trophies"] = max(0, club.get("trophies", 0) + delta)
                club[{"W": "wins", "D": "draws", "L": "losses"}[r]] += 1
                club["xp"] = club.get("xp", 0) + {"W": 60, "D": 35, "L": 20}[r]
                entry = {"match": match_id, "vs": opp["name"], "for": gf, "against": ga, "result": r, "delta": delta, "t": _now()}
                club["history"] = (club.get("history", []) + [entry])[-40:]
                if not club.get("bot"):
                    who = by if club is h else "League"
                    club["chat"] = (club.get("chat", []) + [{"by": "Scout", "bot": True, "t": _now(),
                                    "text": f"{'Win' if r == 'W' else 'Draw' if r == 'D' else 'Loss'} {gf} {ga} vs {opp['name']}. Trophies {'+' if delta >= 0 else ''}{delta}. Played by {who}."}])[-80:]
                if club is h:
                    res = entry
            self._write()
            return res
