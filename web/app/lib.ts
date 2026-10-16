// Shared types and pure helpers. No AI here, only ground truth from the synthetic events.

export const API = process.env.NEXT_PUBLIC_API || "";

// ---------- managers and clubs ----------
export type User = { id: string; name: string; avatar: string; club?: string | null };
export type PlayerCard = { name: string; pos: "GK" | "DF" | "MF" | "FW"; rating: number; trait: string };
export type Club = {
  id?: string; name: string; short: string; motto: string; city?: string; style: string;
  colors: { primary: string; secondary: string }; players: PlayerCard[];
  trophies?: number; wins?: number; draws?: number; losses?: number; power?: number; level?: number; xp?: number;
  members?: number; code?: string; owner?: string; bot?: boolean;
  roster?: { id: string; name: string; avatar: string; role: string }[];
  history?: { match: string; vs: string; for: number; against: number; result: "W" | "D" | "L"; delta: number; t: number }[];
};
export type ChatMsg = { by: string; text: string; t: number; avatar?: string; bot?: boolean };

const KEY = "pitchmind_user";
export function getUser(): User | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function setUser(u: User) {
  try { localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* private mode */ }
}
export function logout() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  if (typeof window !== "undefined") window.location.href = "/";
}

/** Small fetch helper. Sends the manager id and turns API errors into readable messages. */
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const u = typeof window !== "undefined" ? getUser() : null;
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(u ? { "X-User": u.id } : {}), ...(init.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error("Please sign in again."); }
  if (!r.ok) throw new Error(d?.detail || `Request failed (${r.status})`);
  return d as T;
}

export type Ev = {
  id: number; minute: number; second: number; team: string; player_id: string; player: string;
  type: string; zone: string; outcome: string; xg: number;
};
export type Insight = {
  claim: string; team: string; metric: string; value: number;
  event_ids: number[]; minute: number; proof: string; note: string; window: [number, number];
};
export type Recap = {
  headline: string; summary: string; voiceover?: string;
  turning_points: { minute: number; text: string }[];
  player_of_the_match?: { name: string; reason: string };
};

export const AGENTS = [
  { key: "Lead", role: "Orchestrator", blurb: "Splits the match into windows and routes work." },
  { key: "Analyst", role: "Finds moments", blurb: "Spots pressing spells, xG swings and key chances." },
  { key: "Proof", role: "Checks facts", blurb: "Verifies every claim against raw events. Rejects bad numbers." },
  { key: "Story", role: "Writes on air", blurb: "Turns a verified insight into one presenter line." },
  { key: "Recap", role: "Full time", blurb: "Writes the match report from verified insights only." },
] as const;

// 4-3-3 for the home side, attacking to the right. x along the pitch, y across, both 0..100.
const HOME_SHAPE: Record<string, [number, number]> = {
  GK: [5, 50],
  "2": [20, 14], "3": [17, 38], "4": [17, 62], "5": [20, 86],
  "6": [32, 50], "7": [37, 27], "8": [37, 73],
  "9": [46, 50], "10": [44, 18], "11": [44, 82],
};

export type Player = { id: string; name: string; num: string; side: "home" | "away"; x: number; y: number };

export function lineup(events: Ev[], home: string, keepers?: { home: string; away: string }): Player[] {
  const names = new Map<string, { name: string; side: "home" | "away" }>();
  for (const e of events) names.set(e.player_id, { name: e.player, side: e.team === home ? "home" : "away" });
  const out: Player[] = [];
  for (const side of ["home", "away"] as const) {
    const pre = side === "home" ? "H" : "A";
    for (const [num, [x, y]] of Object.entries(HOME_SHAPE)) {
      const id = num === "GK" ? `${pre}GK` : `${pre}${num}`;
      const name = num === "GK" ? keepers?.[side] ?? "Keeper" : names.get(id)?.name ?? id;
      out.push({ id, name, num: num === "GK" ? "1" : num, side, x: side === "home" ? x : 100 - x, y: side === "home" ? y : 100 - y });
    }
  }
  return out;
}

const PUSH: Record<string, number> = { own_third: -5, middle_third: 2, final_third: 9, box: 14 };

/** Shift both teams toward the attack of the side on the ball. */
export function shifted(players: Player[], ev: Ev | null, home: string): Player[] {
  if (!ev) return players;
  const dir = ev.team === home ? 1 : -1;
  const dx = dir * (PUSH[ev.zone] ?? 0);
  return players.map(p => ({ ...p, x: p.num === "1" ? p.x : Math.max(3, Math.min(97, p.x + dx)) }));
}

export type TeamStats = { goals: number; shots: number; onTarget: number; xg: number; passPct: number; pressures: number; tackles: number };

export function statsTo(events: Ev[], team: string, minute: number): TeamStats {
  const e = events.filter(x => x.team === team && x.minute <= minute);
  const shots = e.filter(x => x.type === "shot");
  const passes = e.filter(x => x.type === "pass");
  const done = passes.filter(x => x.outcome === "complete").length;
  return {
    goals: shots.filter(x => x.outcome === "goal").length,
    shots: shots.length,
    onTarget: shots.filter(x => x.outcome === "goal" || x.outcome === "saved").length,
    xg: Math.round(shots.reduce((a, b) => a + b.xg, 0) * 100) / 100,
    passPct: passes.length ? Math.round((done / passes.length) * 100) : 0,
    pressures: e.filter(x => x.type === "pressure").length,
    tackles: e.filter(x => x.type === "tackle" && x.outcome === "won").length,
  };
}

/** Momentum per 5 minute bucket: positive means home is on top. */
export function momentum(events: Ev[], home: string, upTo: number): number[] {
  const out: number[] = [];
  for (let m = 0; m <= Math.max(upTo, 0); m += 5) {
    let v = 0;
    for (const e of events) {
      if (e.minute < m || e.minute >= m + 5 || e.minute > upTo) continue;
      const w = (e.type === "shot" ? 3 + e.xg * 10 : 0) + (e.zone === "box" ? 1.5 : e.zone === "final_third" ? 1 : 0) + (e.type === "pressure" ? 0.5 : 0);
      v += e.team === home ? w : -w;
    }
    out.push(v);
  }
  return out;
}

export const evLabel = (e: Ev) =>
  `${e.player} ${e.type.replace("_", " ")}${e.type === "shot" ? ` · ${e.outcome.replace("_", " ")}` : ""}`;
