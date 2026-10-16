"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Pitch3D from "../components/Pitch3D";
import Mark from "../components/Mark";
import UserMenu from "../components/UserMenu";
import { API, AGENTS, api, Ev, Insight, Recap, evLabel, lineup, momentum, statsTo } from "../lib";
import { useSim } from "../sim";
import { Line, beep, callFor, shortNote, pauseVoice, resumeVoice, stopVoice, useVoice, voiceBusy } from "../commentary";

type Msg = Record<string, any>;
const short = (n: string) => n.split(" ").filter(w => !/^(FC|AFC|United|City|Town|Athletic|Rovers)$/i.test(w))[0] || n.split(" ")[0];
type Tab = "live" | "notes" | "timeline" | "recap";

export default function Dashboard() {
  const [home, setHome] = useState("Northbridge Rovers");
  const [away, setAway] = useState("Eastvale United");
  const [events, setEvents] = useState<Ev[]>([]);
  const [tone, setTone] = useState("broadcast");
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const [trace, setTrace] = useState<{ text: string; kind?: string; t: string }[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{ verified: number; rejected: number } | null>(null);
  const [win, setWin] = useState<[number, number] | null>(null);
  const [matchId, setMatchId] = useState("");
  const [kits, setKits] = useState<{ home: string; away: string } | null>(null);
  const [keepers, setKeepers] = useState<{ home: string; away: string } | undefined>(undefined);
  const [result, setResult] = useState<{ result: "W" | "D" | "L"; delta: number; for: number; against: number } | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  const [voiceOn, setVoiceOn] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const speak = useVoice(voiceOn);
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const addLine = (l: Line) => setLines(x => [l, ...x].slice(0, 120));
  const [rejections, setRejections] = useState(0);
  const [cere, setCere] = useState<{ kind: "start" | "end"; label: string } | null>(null);
  const [ended, setEnded] = useState(false);
  const [pending, setPending] = useState<Insight[]>([]);
  const [speakingId, setSpeakingId] = useState("");
  const [vo, setVo] = useState<"idle" | "playing" | "paused">("idle");
  const endFired = useRef(false);
  const spokenSlots = useRef(new Set<number>());
  const announced = useRef(false);
  const voiceOnRef = useRef(true);
  voiceOnRef.current = voiceOn;
  const [quiet, setQuiet] = useState(0);
  const es = useRef<EventSource | null>(null);
  const lastMsg = useRef(Date.now());

  useEffect(() => {
    // A club challenge passes ?match=ID. Without it the demo match plays.
    const mid = new URLSearchParams(window.location.search).get("match") || "";
    setMatchId(mid);
    fetch(`${API}/api/events${mid ? `?match=${mid}` : ""}`)
      .then(async r => {
        const d = await r.json();
        if (r.status === 404) throw new Error(d?.detail || "Match not found.");
        return d;
      })
      .then(d => {
        if (!Array.isArray(d?.events)) throw new Error("Backend not ready. Restart uvicorn on port 8000 so /api/events is live.");
        setHome(d.home); setAway(d.away); setEvents(d.events);
        if (d.kits) setKits(d.kits);
        if (d.keepers) setKeepers(d.keepers);
      })
      .catch(ex => setError(ex?.message?.includes("fetch") ? "Backend not ready. Start uvicorn on port 8000." : ex.message));
    return () => es.current?.close();
  }, []);

  // Replay every event in order, never ahead of the window the agents are working on.
  // If the replay falls behind, it speeds up so it stays close to live.
  const [idx, setIdx] = useState(-1);
  const limit = useMemo(() => {
    if (summary) return events.length - 1;
    if (!win) return -1;
    let k = -1;
    events.forEach((e, i) => { if (e.minute <= win[1]) k = i; });
    return k;
  }, [events, win, summary]);
  const ctxAt = (i: number) => {
    let h = 0, a = 0;
    for (let j = 0; j <= i; j++) { const e = events[j]; if (e && e.type === "shot" && e.outcome === "goal") { if (e.team === home) h++; else a++; } }
    return { prev: i > 0 ? events[i - 1] : null, score: [h, a] as [number, number], home, away };
  };
  useEffect(() => {
    if (idx >= limit || cere?.kind === "start") return;
    const lag = limit - idx;
    // The next event is called now, so give the voice time to finish before the play moves on.
    const nxt = events[idx + 1];
    const c = nxt ? callFor(nxt, ctxAt(idx + 1)) : null;
    const voiced = voiceOnRef.current && !!c?.speak && lag <= 30;
    const gap = lag > 30 ? 220 : voiced ? 750 : c ? 520 : 380;
    const t0 = Date.now();
    let timer: any;
    const advance = () => {
      if (voiced && voiceBusy() && Date.now() - t0 < 4500) {
        timer = setTimeout(advance, 120);
        return;
      }
      setIdx(i => i + 1);
    };
    timer = setTimeout(advance, gap);
    return () => clearTimeout(timer);
  }, [idx, limit, cere]);
  const cur: Ev | null = idx >= 0 ? events[idx] ?? null : null;
  const minute = cur?.minute ?? -1;

  // Watchdog: pings arrive every 10s while the agents think.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setQuiet(Math.round((Date.now() - lastMsg.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  const byId = useMemo(() => new Map(events.map(e => [e.id, e])), [events]);
  const base = useMemo(() => lineup(events, home, keepers), [events, home, keepers]);
  const frame = useSim(base, cur, home);

  // Play by play: call notable events as the ball moves.
  useEffect(() => {
    if (!cur) return;
    const c = callFor(cur, ctxAt(idx));
    if (!c) return;
    const id = `e${cur.id}`;
    addLine({ id, minute: cur.minute, text: c.text, kind: c.goal ? "goal" : "pbp" });
    if (c.speak) speakRef.current(c.text, c.goal ? "goal" : "call", { onstart: () => setSpeakingId(id), onend: () => setSpeakingId(x => (x === id ? "" : x)) }, false, c.hype ?? 0);
  }, [cur]);

  // Agent notes go on air only when the match clock reaches them, so voice and play stay together.
  useEffect(() => {
    if (!pending.length) return;
    const now = ended ? 999 : cur?.minute ?? -1;
    const ready = pending.filter(p => p.minute <= now);
    if (!ready.length) return;
    setPending(pending.filter(p => p.minute > now));
    setInsights(i => [...i, ...ready]);
    ready.forEach((ins, k) => {
      const id = `n${ins.minute}-${Date.now()}-${k}`;
      addLine({ id, minute: ins.minute, text: ins.note, kind: "note" });
      const slot = Math.floor(ins.minute / 10);
      if (spokenSlots.current.has(slot)) return;
      spokenSlots.current.add(slot);
      speakRef.current(shortNote(ins.note), "note", { onstart: () => setSpeakingId(id), onend: () => setSpeakingId(x => (x === id ? "" : x)) });
    });
  }, [pending, cur, ended]);

  // 3 2 1 ceremony.
  const runCountdown = (kind: "start" | "end", after: () => void) => {
    const seq = ["3", "2", "1", kind === "start" ? "KICK OFF" : "FULL TIME"];
    let k = 0;
    const step = () => {
      setCere({ kind, label: seq[k] });
      beep(k < 3 ? 660 : 990, k < 3 ? 0.14 : 0.7);
      k++;
      if (k < seq.length) setTimeout(step, 950);
      else setTimeout(() => { setCere(null); after(); }, 1500);
    };
    step();
  };

  // Replay finished: 3 2 1 full time, then the recap goes on air.
  useEffect(() => {
    if (!events.length || endFired.current) return;
    if (idx >= events.length - 1 && (running || summary)) {
      endFired.current = true;
      runCountdown("end", () => setEnded(true));
    }
  }, [idx, events.length, running, summary]);
  // Club match: bank the result once the final whistle has gone.
  useEffect(() => {
    if (!ended || !matchId || result) return;
    api<{ result: any }>(`/api/challenge/${matchId}/finish`, { method: "POST" })
      .then(d => setResult(d.result))
      .catch(() => {});
  }, [ended, matchId, result]);
  useEffect(() => {
    if (!ended || !recap || announced.current) return;
    announced.current = true;
    setTab("recap");
    addLine({ id: "ft", minute: 90, text: `Full time. ${recap.headline}`, kind: "ft" });
    speakRef.current(`Full time! ${shortNote(recap.headline)}`, "note");
  }, [ended, recap]);
  const latest = insights[insights.length - 1];
  const focus = useMemo(
    () => new Set((latest?.event_ids ?? []).map(id => byId.get(id)?.player_id).filter(Boolean) as string[]),
    [latest, byId],
  );

  const hs = statsTo(events, home, minute);
  const as = statsTo(events, away, minute);
  const mom = momentum(events, home, minute);
  const goals = events.filter(e => e.type === "shot" && e.outcome === "goal" && e.minute <= minute);

  const log = (text: string, kind?: string) =>
    setTrace(t => [...t.slice(-60), { text, kind, t: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }) }]);

  const begin = () => {
    if (cere || running) return;
    stopVoice(); setVo("idle");
    runCountdown("start", start);
  };

  const start = () => {
    es.current?.close();
    endFired.current = false; announced.current = false; spokenSlots.current = new Set();
    setEnded(false); setPending([]); setSpeakingId("");
    setRunning(true); setInsights([]); setRecap(null); setTrace([]); setError(""); setSummary(null);
    setWin(null); setIdx(-1); setVisited([]); setRejections(0); setTab("live"); setQuiet(0); setLines([]);
    speakRef.current("And we're off!", "note");
    lastMsg.current = Date.now();
    const src = new EventSource(`${API}/api/stream?tone=${tone}&speed=0.6${matchId ? `&match=${matchId}` : ""}`);
    es.current = src;
    src.onmessage = ev => {
      lastMsg.current = Date.now();
      const m: Msg = JSON.parse(ev.data);
      if (m.type === "ping") return;
      if (m.type === "window") {
        setWin([Math.max(0, m.minute - 9), m.minute]);
        setVisited(["Lead"]);
      } else if (m.type === "handoff") {
        setActive(m.to);
        setVisited(v => (v.includes(m.to) ? v : [...v, m.to]));
        log(`${m.from} → ${m.to}${m.claims != null ? ` · ${m.claims} claim${m.claims === 1 ? "" : "s"}` : ""}`);
      } else if (m.type === "insight") {
        setPending(p => [...p, m.insight]);
        log(`Story → on air · ${m.insight.minute}'`, "ok");
      } else if (m.type === "recovery") {
        if (String(m.note).startsWith("Proof rejected")) setRejections(r => r + 1);
        log(m.note, "rec");
      } else if (m.type === "recap") {
        setRecap(m.recap);
      } else if (m.type === "error") {
        setError(m.message); log(m.message, "bad");
      } else if (m.type === "done") {
        setSummary({ verified: m.verified, rejected: m.rejected });
        setActive(null); setRunning(false); src.close();
        log("Full time · stream closed", "ok");
      }
    };
    src.onerror = () => {
      if (src.readyState === EventSource.CLOSED || Date.now() - lastMsg.current > 25000) {
        setError("Lost the live stream. Check the backend window for errors.");
        setRunning(false); setActive(null); src.close();
      }
    };
  };

  const playRecap = () => {
    if (!recap?.voiceover) return;
    speak(recap.voiceover, "note", { onstart: () => setVo("playing"), onend: () => setVo("idle") }, true);
  };
  const toggleRecap = () => {
    if (vo === "idle") playRecap();
    else if (vo === "playing") { pauseVoice(); setVo("paused"); }
    else { resumeVoice(); setVo("playing"); }
  };
  const stopRecap = () => { stopVoice(); setVo("idle"); };

  const status = summary ? "Full time" : running ? (quiet > 12 ? `Agents thinking · ${quiet}s` : "Live") : "Ready";

  return (
    <div className="dash" style={kits ? ({ ["--home" as any]: kits.home, ["--away" as any]: kits.away }) : undefined}>
      <div className="floodlights dim" aria-hidden><span /><span /><span /></div>

      <nav className="dnav glass">
        <Link href="/" className="logo"><Mark /> PitchMind</Link>
        <div className={"livepill" + (running ? " on" : "")}><span className="live-dot" />{status}</div>
        <div className="controls">
          <button className={"mic" + (voiceOn ? " on" : "")} onClick={() => setVoiceOn(v => !v)} title="Spoken commentary">
            {voiceOn ? "🎙 Commentary on" : "🔇 Commentary off"}
          </button>
          <select value={tone} onChange={e => setTone(e.target.value)} disabled={running}>
            <option value="broadcast">Broadcast tone</option>
            <option value="pundit">Pundit tone</option>
            <option value="family">Family tone</option>
          </select>
          <button className="cta small" onClick={begin} disabled={running || !!cere || !events.length}>
            {running ? "Agents working…" : summary ? "Replay match" : "Start match"}
          </button>
          <UserMenu />
        </div>
      </nav>

      {result && (
        <div className={"resultbar glass " + result.result}>
          <span className="rbig">{result.result === "W" ? "VICTORY" : result.result === "D" ? "DRAW" : "DEFEAT"}</span>
          <span>{result.for} – {result.against} vs {away}</span>
          <span className="rtro">{result.delta >= 0 ? "+" : ""}{result.delta} 🏆</span>
          <Link href="/club" className="cta small">Back to club <span>→</span></Link>
        </div>
      )}

      <div className="dgrid">
        {/* LEFT */}
        <aside className="col">
          <div className="glass panel">
            <div className="ph"><h2>AI overview</h2><span className="muted">Ground truth</span></div>
            <div className="tiles">
              <Tile label="Verified notes" value={insights.length} sub="passed Proof" accent />
              <Tile label="Rejected" value={summary?.rejected ?? rejections} sub="claims sent back" warn />
              <Tile label="Shots" value={`${hs.shots}–${as.shots}`} sub={`${hs.onTarget}–${as.onTarget} on target`} />
              <Tile label="xG" value={`${hs.xg.toFixed(2)}`} sub={`vs ${as.xg.toFixed(2)}`} />
            </div>
          </div>

          <div className="glass panel">
            <div className="ph"><h2>Momentum</h2><span className="muted">5 min buckets</span></div>
            <div className="mom">
              {Array.from({ length: 19 }).map((_, k) => {
                const v = mom[k];
                const peak = Math.max(1, ...mom.map(Math.abs));
                const h = v == null ? 0 : Math.max(2, (Math.abs(v) / peak) * 44);
                return (
                  <div key={k} className="mcol">
                    <div className={"mbar " + (v == null ? "" : v >= 0 ? "home" : "away")}
                      style={{ height: h, transform: v != null && v < 0 ? "translateY(100%)" : undefined }} />
                  </div>
                );
              })}
            </div>
            <div className="mlegend"><span className="home">{home}</span><span className="away">{away}</span></div>
          </div>

          <div className="glass panel">
            <div className="ph"><h2>Match stats</h2></div>
            <Bar label="Goals" a={hs.goals} b={as.goals} />
            <Bar label="Shots" a={hs.shots} b={as.shots} />
            <Bar label="Pass %" a={hs.passPct} b={as.passPct} />
            <Bar label="Pressures" a={hs.pressures} b={as.pressures} />
            <Bar label="Tackles won" a={hs.tackles} b={as.tackles} />
          </div>
        </aside>

        {/* CENTER */}
        <main className="col">
          <div className="glass panel pitchcard">
            <div className="ph">
              <h2>Live pitch</h2>
              <span className="ticker">{cur ? <><b>{cur.minute}'</b> {evLabel(cur)}</> : "Press Start match to kick off"}</span>
            </div>
            <Pitch3D
              players={frame.players}
              ball={frame.ball}
              carrier={cur?.player_id ?? null}
              focus={focus}
              caption={cur && cur.type === "shot" && cur.outcome !== "goal" ? `${cur.minute}' ${cur.outcome.replace("_", " ")}` : undefined}
              goal={frame.goal ? { player: frame.goal.player, team: frame.goal.team, minute: frame.goal.minute } : null}
              board={{ home: short(home), away: short(away), hs: hs.goals, as: as.goals, clock: ended ? "FULL TIME" : minute >= 0 ? `${Math.max(1, minute)}'` : "KICK OFF" }}
              arena={`${home.split(" ")[0]} Arena`}
            />
            <div className="pitchlegend">
              <span><i className="dot home" />{home}</span>
              <span><i className="dot focus" />Cited by the latest verified note</span>
              <span><i className="dot away" />{away}</span>
            </div>
          </div>

          <div className="glass panel">
            <div className="ph"><h2>Agent team</h2><span className="muted">{win ? `Window ${win[0]}–${win[1]}'` : "Idle"}</span></div>
            <div className="pipeline">
              {AGENTS.map((a, k) => (
                <div key={a.key} className="pnode-wrap">
                  <div className={"pnode" + (active === a.key ? " on" : visited.includes(a.key) ? " done" : "")}>
                    <div className="pico">{a.key[0]}</div>
                    <div className="pname">{a.key}</div>
                    <div className="prole">{a.role}</div>
                  </div>
                  {k < AGENTS.length - 1 && <div className={"plink" + (visited.includes(AGENTS[k + 1].key) ? " lit" : "")}><span /></div>}
                </div>
              ))}
            </div>
            <div className="trace">
              {trace.length === 0 && <div className="muted">Agent handoffs and recoveries will stream here.</div>}
              {trace.slice().reverse().map((t, i) => (
                <div key={i} className={t.kind}><span className="tt">{t.t}</span>{t.text}</div>
              ))}
            </div>
          </div>
        </main>

        {/* RIGHT */}
        <aside className="col">
          <div className="glass panel matchcard">
            <div className="mc-top"><span>Synthetic league</span><span>Matchday 1</span></div>
            <div className="mc-row">
              <div className="crest home">{initials(home)}</div>
              <div className="mc-score">
                <div className="big">{hs.goals} <span>–</span> {as.goals}</div>
                <div className="clockpill">{ended ? "FT" : minute >= 0 ? `${Math.max(1, minute)}'` : "KO"}</div>
              </div>
              <div className="crest away">{initials(away)}</div>
            </div>
            <div className="mc-names"><span className="home">{home}</span><span className="away">{away}</span></div>
            <div className="tabs">
              {(["live", "notes", "timeline", "recap"] as Tab[]).map(t => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "notes" ? `Notes ${insights.length ? `(${insights.length})` : ""}` : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="glass panel feed">
            {error && <div className="err">{error}</div>}
            {tab === "live" && (
              <div className="comms">
                {lines.length === 0 && <div className="empty">Live commentary starts at kick off.</div>}
                {lines.map(l => (
                  <div key={l.id} className={"cl " + l.kind + (speakingId === l.id ? " now" : "")}>
                    <span className="clm">{l.kind === "ft" ? "FT" : `${l.minute}'`}</span>
                    <span className="clt">{l.kind === "note" && <span className="badge">✓ Proof</span>} {l.text}</span>
                  </div>
                ))}
              </div>
            )}
            {tab === "notes" && (
              <div className="notes">
                {insights.length === 0 && <div className="empty">Presenter notes appear here once Proof checks them.</div>}
                {insights.slice().reverse().map((ins, i) => <Note key={insights.length - i} ins={ins} />)}
              </div>
            )}
            {tab === "timeline" && (
              <div className="timeline">
                {goals.length === 0 && insights.length === 0 && <div className="empty">Goals and key moments land here.</div>}
                {[...goals.map(g => ({ m: g.minute, goal: true, text: `${g.player} scores for ${g.team}` })),
                  ...insights.map(s => ({ m: s.minute, goal: false, text: s.claim }))]
                  .sort((a, b) => b.m - a.m)
                  .map((t, i) => (
                    <div key={i} className={"tl" + (t.goal ? " goal" : "")}>
                      <span className="tlm">{t.m}'</span>
                      <span className="tld" />
                      <span className="tlt">{t.goal ? "⚽ " : ""}{t.text}</span>
                    </div>
                  ))}
              </div>
            )}
            {tab === "recap" && (
              <div className="recap">
                {!recap && <div className="empty">The Recap agent writes this at the final whistle.</div>}
                {recap && (
                  <>
                    <h3>{recap.headline}</h3>
                    <p>{recap.summary}</p>
                    <div className="tp">
                      {recap.turning_points?.map((t, i) => <div key={i}><span>{t.minute}'</span>{t.text}</div>)}
                    </div>
                    {recap.player_of_the_match && (
                      <div className="potm"><span className="muted">Player of the match</span><b>{recap.player_of_the_match.name}</b>{recap.player_of_the_match.reason}</div>
                    )}
                    {recap.voiceover && (
                      <div className="vorow">
                        <button className="cta small" onClick={toggleRecap}>
                          {vo === "idle" ? "▶ Play voiceover" : vo === "playing" ? "⏸ Pause voiceover" : "▶ Resume voiceover"}
                        </button>
                        {vo !== "idle" && <button className="ghost small" onClick={stopRecap}>■ Stop</button>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
      <div className="foot">Synthetic match data. Teams and players are fictional.</div>

      {cere && (
        <div className={"ceremony " + cere.kind} aria-live="assertive">
          <div className="cere-top">{cere.kind === "start" ? "Match starts in" : "Match ends"}</div>
          <div key={cere.label} className={"cere-num" + (cere.label.length > 1 ? " word" : "")}>{cere.label}</div>
          <div className="cere-teams"><span className="home">{home}</span> <i>vs</i> <span className="away">{away}</span></div>
        </div>
      )}
    </div>
  );
}

function initials(s: string) {
  return s.split(" ").map(w => w[0]).join("").slice(0, 2);
}

function Tile({ label, value, sub, accent, warn }: { label: string; value: any; sub: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={"tile" + (accent ? " accent" : "") + (warn ? " warn" : "")}>
      <div className="tl-label">{label}</div>
      <div className="tl-value">{value}</div>
      <div className="tl-sub">{sub}</div>
    </div>
  );
}

function Bar({ label, a, b }: { label: string; a: number; b: number }) {
  const tot = a + b || 1;
  return (
    <div className="sbar">
      <div className="sb-top"><b>{a}</b><span>{label}</span><b>{b}</b></div>
      <div className="sb-track">
        <div className="sb-home" style={{ width: `${(a / tot) * 100}%` }} />
        <div className="sb-away" style={{ width: `${(b / tot) * 100}%` }} />
      </div>
    </div>
  );
}

function Note({ ins }: { ins: Insight }) {
  const [open, setOpen] = useState(false);
  const [fan, setFan] = useState("");
  const [busy, setBusy] = useState("");
  const rewrite = async (profile: string) => {
    setBusy(profile); setFan("");
    try {
      const r = await fetch(`${API}/api/fan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: ins.note, profile }),
      });
      setFan((await r.json()).note);
    } catch { setFan("Fan agent unavailable."); }
    setBusy("");
  };
  return (
    <div className="note">
      <div className="meta">
        <span className="minute">{ins.minute}'</span>
        <span className="badge">✓ Proof verified</span>
      </div>
      <p>{ins.note}</p>
      <div className="note-actions">
        <button className="link" onClick={() => setOpen(!open)}>{open ? "Hide proof" : "Show proof"}</button>
        <div className="fanrow">
          {["kids", "tactical", "casual"].map(p => (
            <button key={p} onClick={() => rewrite(p)} disabled={!!busy}>{busy === p ? "…" : p}</button>
          ))}
        </div>
      </div>
      {open && (
        <div className="proof">
          <div><b>Claim</b> {ins.claim}</div>
          <div><b>Metric</b> {ins.metric} = {ins.value} ({ins.team})</div>
          <div><b>Proof agent</b> {ins.proof}</div>
          <div className="chips">{ins.event_ids.map(id => <span className="chip" key={id}>#{id}</span>)}</div>
        </div>
      )}
      {fan && <div className="fanout">{fan}</div>}
    </div>
  );
}
