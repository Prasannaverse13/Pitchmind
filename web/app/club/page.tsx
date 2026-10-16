"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Mark from "../components/Mark";
import Crest from "../components/Crest";
import UserMenu from "../components/UserMenu";
import { ChatMsg, Club, PlayerCard, User, api, getUser } from "../lib";

const STYLES = [
  { k: "", label: "Any style" },
  { k: "possession", label: "Possession" },
  { k: "press", label: "High press" },
  { k: "counter", label: "Counter attack" },
  { k: "direct", label: "Direct" },
];
const IDEAS = [
  "Neon street footballers from a rainy port city",
  "Old mining town grinders who never give up",
  "Young academy wonderkids, fast and fearless",
  "Desert club with a golden keeper and a wall of a defence",
];
const SHAPE: Record<string, [number, number][]> = {
  GK: [[50, 90]],
  DF: [[14, 70], [38, 74], [62, 74], [86, 70]],
  MF: [[26, 48], [50, 52], [74, 48]],
  FW: [[20, 22], [50, 16], [80, 22]],
};
const styleName = (k: string) => STYLES.find(s => s.k === k)?.label ?? k;
const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

export default function ClubPage() {
  const [user, setU] = useState<User | null>(null);
  const [club, setClub] = useState<Club | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ user: User; club: Club | null }>("/api/me");
      setU(d.user); setClub(d.club);
    } catch (ex: any) { setErr(ex.message); }
  }, []);

  useEffect(() => {
    if (!getUser()) { window.location.replace("/login"); return; }
    setU(getUser());
    load();
  }, [load]);

  return (
    <div className="clubwrap">
      <div className="floodlights dim" aria-hidden><span /><span /><span /></div>
      <nav className="dnav glass">
        <Link href="/" className="logo"><Mark /> PitchMind</Link>
        <div className="navmid">
          <Link href="/club" className="on">Club</Link>
          <Link href="/dashboard">Demo match</Link>
        </div>
        <UserMenu club={false} />
      </nav>

      {err && <div className="err">{err} <button className="link" onClick={load}>Retry</button></div>}
      {club === undefined && !err && <div className="loading glass">Loading your club…</div>}
      {club === null && <Onboard onDone={c => { setClub(c); }} />}
      {club && editing && <Builder start={club} editing onCancel={() => setEditing(false)} onDone={c => { setClub(c); setEditing(false); }} />}
      {club && !editing && user && <Hub club={club} user={user} reload={load} onEdit={() => setEditing(true)} onLeft={() => setClub(null)} />}
    </div>
  );
}

/* ---------------- no club yet ---------------- */

function Onboard({ onDone }: { onDone: (c: Club) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const join = async () => {
    setBusy(true); setErr("");
    try { onDone((await api<{ club: Club }>("/api/club/join", { method: "POST", body: JSON.stringify({ code }) })).club); }
    catch (ex: any) { setErr(ex.message); }
    setBusy(false);
  };
  return (
    <div className="onboard">
      <div className="onhead">
        <div className="eyebrow">Your club starts here</div>
        <h1>Build a club with AI, or join your mates</h1>
        <p className="muted big2">Describe your dream side and the Scout Agent on Microsoft Foundry drafts the badge, kit, style and a full squad of 11. Every name is invented.</p>
      </div>
      <div className="ongrid">
        <Builder onDone={onDone} />
        <div className="glass panel joincard">
          <div className="ph"><h3>Join a club</h3><span className="lbl">Invite code</span></div>
          <p className="muted">Got a code from a friend? Drop it here and you are in the dressing room.</p>
          <input className="inp code" value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3" />
          {err && <div className="err">{err}</div>}
          <button className="cta wide" disabled={busy || code.length < 6} onClick={join}>{busy ? "Joining…" : "Join club"} <span>→</span></button>
          <div className="howto">
            <div><b>1</b> Build or join a club</div>
            <div><b>2</b> Share your code with friends</div>
            <div><b>3</b> Challenge rivals, AI agents call the match</div>
            <div><b>4</b> Win trophies and climb the ladder</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- AI builder ---------------- */

function Builder({ start, editing, onDone, onCancel }: { start?: Club; editing?: boolean; onDone?: (c: Club) => void; onCancel?: () => void }) {
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState("");
  const [draft, setDraft] = useState<Club | null>(start ? JSON.parse(JSON.stringify(start)) : null);
  const [by, setBy] = useState(start ? "your club" : "");
  const [busy, setBusy] = useState<"" | "ai" | "save">("");
  const [err, setErr] = useState("");

  const ask = async () => {
    setBusy("ai"); setErr("");
    try {
      const d = await api<{ club: Club; by: string }>("/api/club/ai", { method: "POST", body: JSON.stringify({ prompt: idea, style }) });
      setDraft(d.club); setBy(d.by);
    } catch (ex: any) { setErr(ex.message); }
    setBusy("");
  };
  const save = async () => {
    if (!draft) return;
    setBusy("save"); setErr("");
    try {
      const d = await api<{ club: Club }>("/api/club", { method: editing ? "PUT" : "POST", body: JSON.stringify({ club: draft }) });
      if (onDone) onDone(d.club); else window.location.reload();
    } catch (ex: any) { setErr(ex.message); setBusy(""); }
  };
  const set = (patch: Partial<Club>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const setP = (i: number, patch: Partial<PlayerCard>) =>
    setDraft(d => (d ? { ...d, players: d.players.map((p, k) => (k === i ? { ...p, ...patch } : p)) } : d));
  const pow = draft ? Math.round(draft.players.reduce((a, p) => a + Number(p.rating || 0), 0) / draft.players.length) : 0;

  return (
    <div className="glass panel builder">
      <div className="ph">
        <h3>{editing ? "Edit your club" : "Build with AI"}</h3>
        <span className="lbl scout">🧠 Scout Agent</span>
      </div>
      <label className="fl">Describe your club</label>
      <textarea className="inp area" value={idea} onChange={e => setIdea(e.target.value)} maxLength={400}
        placeholder="e.g. A fearless young side from a foggy harbour town who press like crazy" />
      <div className="ideas">
        {IDEAS.map(x => <button key={x} className="chipbtn" onClick={() => setIdea(x)}>{x}</button>)}
      </div>
      <div className="stylerow">
        {STYLES.map(s => <button key={s.k} className={"chipbtn" + (style === s.k ? " on" : "")} onClick={() => setStyle(s.k)}>{s.label}</button>)}
      </div>
      <button className="cta wide" onClick={ask} disabled={!!busy}>
        {busy === "ai" ? <>Scouting the world… <span className="spin" /></> : draft ? <>Ask the Scout again <span>↻</span></> : <>Ask the Scout Agent <span>→</span></>}
      </button>
      {err && <div className="err">{err}</div>}

      {draft && (
        <div className={"draft" + (busy === "ai" ? " dim" : "")}>
          <div className="drafthead">
            <Crest club={draft} size={78} />
            <div className="dfields">
              <input className="inp title" value={draft.name} maxLength={28} onChange={e => set({ name: e.target.value })} />
              <input className="inp" value={draft.motto} maxLength={60} onChange={e => set({ motto: e.target.value })} />
              <div className="drow">
                <input className="inp short" value={draft.short} maxLength={3} onChange={e => set({ short: e.target.value.toUpperCase() })} />
                <label className="swatch">Kit<input type="color" value={draft.colors.primary} onChange={e => set({ colors: { ...draft.colors, primary: e.target.value } })} /></label>
                <label className="swatch">Trim<input type="color" value={draft.colors.secondary} onChange={e => set({ colors: { ...draft.colors, secondary: e.target.value } })} /></label>
                <select value={draft.style} onChange={e => set({ style: e.target.value })}>
                  {STYLES.slice(1).map(s => <option key={s.k} value={s.k}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="powerbox"><div className="pw">{pow}</div><div className="muted">Power</div></div>
          </div>
          <div className="muted tiny">Drafted by {by}. Edit any name, then found your club.</div>
          <div className="squadedit">
            {draft.players.map((p, i) => (
              <div key={i} className="prow">
                <span className={"pos " + p.pos}>{p.pos}</span>
                <input className="inp pn" value={p.name} maxLength={28} onChange={e => setP(i, { name: e.target.value })} />
                <span className="trait">{p.trait}</span>
                <span className="rating">{p.rating}</span>
              </div>
            ))}
          </div>
          <div className="draftbtns">
            {onCancel && <button className="ghost small" onClick={onCancel}>Cancel</button>}
            <button className="cta" onClick={save} disabled={!!busy || draft.name.trim().length < 2}>
              {busy === "save" ? "Saving…" : editing ? "Save changes" : "Found this club"} <span>→</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- club hub ---------------- */

type Tab = "battle" | "squad" | "ladder";

function Hub({ club, user, reload, onEdit, onLeft }: { club: Club; user: User; reload: () => void; onEdit: () => void; onLeft: () => void }) {
  const [tab, setTab] = useState<Tab>("battle");
  const [rivals, setRivals] = useState<Club[]>([]);
  const [ladder, setLadder] = useState<Club[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const owner = club.owner === user.id;
  const lvlXp = (club.xp ?? 0) % 100;
  const rank = ladder.findIndex(c => c.id === club.id) + 1;

  useEffect(() => {
    api<{ rivals: Club[] }>("/api/club/rivals").then(d => setRivals(d.rivals)).catch(e => setErr(e.message));
    api<{ clubs: Club[] }>("/api/ladder").then(d => setLadder(d.clubs)).catch(() => {});
  }, [club.trophies]);

  const fight = async (opp: Club) => {
    setBusy(opp.id!); setErr("");
    try {
      const d = await api<{ match: string }>("/api/challenge", { method: "POST", body: JSON.stringify({ opponent: opp.id }) });
      window.location.href = `/dashboard?match=${d.match}`;
    } catch (ex: any) { setErr(ex.message); setBusy(""); }
  };
  const leave = async () => {
    if (!window.confirm(`Leave ${club.name}?`)) return;
    try { await api("/api/club/leave", { method: "POST" }); onLeft(); } catch (ex: any) { setErr(ex.message); }
  };
  const copy = () => {
    navigator.clipboard?.writeText(club.code || "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  return (
    <div className="hub" style={{ ["--club" as any]: club.colors.primary }}>
      {/* left: club card */}
      <aside className="hcol">
        <div className="glass panel clubcard">
          <div className="cc-top">
            <Crest club={club} size={92} />
            <div>
              <h2>{club.name}</h2>
              <div className="muted">{club.motto}</div>
              <div className="ccchips">
                <span className="lbl">{styleName(club.style)}</span>
                <span className="lbl">Power {club.power}</span>
              </div>
            </div>
          </div>
          <div className="trophy">
            <div className="tro">🏆 <b>{club.trophies}</b><span>trophies</span></div>
            <div className="lvl">
              <div className="lvlbadge">Lv {club.level}</div>
              <div className="xpbar"><span style={{ width: `${lvlXp}%` }} /></div>
            </div>
          </div>
          <div className="wdl">
            <div><b>{club.wins}</b><span>Won</span></div>
            <div><b>{club.draws}</b><span>Drawn</span></div>
            <div><b>{club.losses}</b><span>Lost</span></div>
            <div><b>{rank || "–"}</b><span>Rank</span></div>
          </div>
          <div className="invite">
            <div>
              <div className="muted">Invite code</div>
              <div className="codebig">{club.code}</div>
            </div>
            <button className="ghost small" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
          </div>
          <div className="ph mt"><h3>Members</h3><span className="lbl">{club.roster?.length ?? 0} / 30</span></div>
          <div className="roster">
            {club.roster?.map(m => (
              <div key={m.id} className="mem">
                <span className="uava" style={{ background: m.avatar }}>{m.name.slice(0, 1).toUpperCase()}</span>
                <span className="mn">{m.name}{m.id === user.id && <em> (you)</em>}</span>
                <span className={"role " + m.role.toLowerCase()}>{m.role}</span>
              </div>
            ))}
          </div>
          <div className="ccbtns">
            {owner && <button className="ghost small" onClick={onEdit}>Edit club</button>}
            <button className="ghost small danger" onClick={leave}>Leave club</button>
          </div>
        </div>
      </aside>

      {/* centre */}
      <main className="hcol">
        <div className="tabs big">
          <button className={tab === "battle" ? "on" : ""} onClick={() => setTab("battle")}>⚔️ Battle</button>
          <button className={tab === "squad" ? "on" : ""} onClick={() => setTab("squad")}>👕 Squad</button>
          <button className={tab === "ladder" ? "on" : ""} onClick={() => setTab("ladder")}>🏆 Ladder</button>
        </div>
        {err && <div className="err">{err}</div>}

        {tab === "battle" && (
          <div className="glass panel">
            <div className="ph"><h3>Find a match</h3><span className="lbl">Rivals near your trophies</span></div>
            <p className="muted">Pick a rival. A fresh synthetic match is built from both squads, then the agent team calls it live and Proof checks every claim.</p>
            <div className="rivals">
              {rivals.map(r => {
                const diff = (r.power ?? 0) - (club.power ?? 0);
                const odds = diff > 4 ? "Tough" : diff < -4 ? "Favourable" : "Even";
                return (
                  <div key={r.id} className="rival">
                    <Crest club={r} size={48} />
                    <div className="rv">
                      <div className="rn">{r.name}{!r.bot && <span className="humantag">Players</span>}</div>
                      <div className="muted">🏆 {r.trophies} · Power {r.power} · {styleName(r.style)}</div>
                    </div>
                    <span className={"odds " + odds.toLowerCase()}>{odds}</span>
                    <button className="cta small" disabled={!!busy} onClick={() => fight(r)}>{busy === r.id ? "Kicking off…" : "Challenge"}</button>
                  </div>
                );
              })}
              {!rivals.length && <div className="empty">Loading rivals…</div>}
            </div>
            <div className="rules muted">Win +30 🏆 · Draw +8 · Loss −18. Every member can play for the club.</div>
          </div>
        )}

        {tab === "squad" && (
          <div className="glass panel">
            <div className="ph"><h3>Starting XI</h3><span className="lbl">4-3-3</span></div>
            <div className="minipitch" style={{ ["--kit" as any]: club.colors.primary }}>
              {(["GK", "DF", "MF", "FW"] as const).flatMap(pos =>
                club.players.filter(p => p.pos === pos).map((p, i) => {
                  const [x, y] = SHAPE[pos][i] ?? [50, 50];
                  return (
                    <div key={pos + i} className="mp" style={{ left: `${x}%`, top: `${y}%` }}>
                      <div className="mpshirt">{p.rating}</div>
                      <div className="mpname">{p.name.split(" ").slice(-1)[0]}</div>
                      <div className="mptrait">{p.trait}</div>
                    </div>
                  );
                }))}
            </div>
            {owner ? <button className="ghost small" onClick={onEdit}>Rebuild with the Scout Agent</button> : <div className="muted">Only the owner can change the squad.</div>}
          </div>
        )}

        {tab === "ladder" && (
          <div className="glass panel">
            <div className="ph"><h3>Trophy ladder</h3><span className="lbl">Top 50</span></div>
            <div className="ladder">
              {ladder.map((c, i) => (
                <div key={c.id} className={"lrow" + (c.id === club.id ? " me" : "")}>
                  <span className="lr">{i + 1}</span>
                  <Crest club={c} size={30} />
                  <span className="ln">{c.name}{!c.bot && <span className="humantag">Players {c.members}</span>}</span>
                  <span className="muted">Lv {c.level}</span>
                  <span className="lt">🏆 {c.trophies}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="glass panel">
          <div className="ph"><h3>Match history</h3></div>
          <div className="hist">
            {club.history?.length ? club.history.map(h => (
              <div key={h.match} className={"hrow " + h.result}>
                <span className="res">{h.result}</span>
                <span className="hv">{h.for} – {h.against} vs {h.vs}</span>
                <span className="hd">{h.delta >= 0 ? "+" : ""}{h.delta} 🏆</span>
                <span className="muted">{ago(h.t)}</span>
              </div>
            )) : <div className="empty">No matches yet. Challenge a rival to start your story.</div>}
          </div>
        </div>
      </main>

      {/* right: chat */}
      <aside className="hcol">
        <Chat me={user} onActivity={reload} />
      </aside>
    </div>
  );
}

/* ---------------- club chat ---------------- */

function Chat({ me, onActivity }: { me: User; onActivity: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const d = await api<{ chat: ChatMsg[] }>("/api/club/chat");
        if (!alive) return;
        setMsgs(d.chat);
        // Scout posts when someone joins, leaves or plays. Refresh the club card when that happens.
        const sys = d.chat.filter(m => m.bot).length;
        if (last.current && sys > last.current) onActivity();
        last.current = sys;
      } catch { /* keep polling */ }
    };
    pull();
    const t = setInterval(pull, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [onActivity]);

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" }); }, [msgs.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text; setText("");
    try { setMsgs((await api<{ chat: ChatMsg[] }>("/api/club/chat", { method: "POST", body: JSON.stringify({ text: t }) })).chat); }
    catch { setText(t); }
  };

  return (
    <div className="glass panel chat">
      <div className="ph"><h3>Club chat</h3><span className="livepill on"><span className="live-dot" />Live</span></div>
      <div className="msgs" ref={box}>
        {msgs.map((m, i) => (
          <div key={i} className={"msg" + (m.bot ? " sys" : "") + (m.by === me.name ? " mine" : "")}>
            {!m.bot && <span className="uava sm" style={{ background: m.avatar }}>{m.by.slice(0, 1).toUpperCase()}</span>}
            <div>
              <div className="mb">{m.bot ? "🧠 Scout" : m.by} <span className="muted">{ago(m.t)}</span></div>
              <div className="mt">{m.text}</div>
            </div>
          </div>
        ))}
        {!msgs.length && <div className="empty">Say hello to your club.</div>}
      </div>
      <form className="say" onSubmit={send}>
        <input className="inp" value={text} maxLength={240} onChange={e => setText(e.target.value)} placeholder="Message your club" />
        <button className="cta small">Send</button>
      </form>
    </div>
  );
}
