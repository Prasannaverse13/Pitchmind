"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Pitch3D from "./components/Pitch3D";
import Mark from "./components/Mark";
import UserMenu from "./components/UserMenu";
import { API, AGENTS, Ev, lineup } from "./lib";
import { useSim } from "./sim";

const H = "Northbridge Rovers", A = "Eastvale United";
const mk = (id: number, team: string, pid: string, player: string, type: string, zone: string, outcome: string, minute: number): Ev =>
  ({ id, minute, second: 0, team, player_id: pid, player, type, zone, outcome, xg: type === "shot" ? 0.3 : 0 });
// Used when the backend is not running, so the hero still plays.
const FALLBACK: Ev[] = [
  mk(1, H, "H3", "Liam Hartley", "pass", "own_third", "complete", 40),
  mk(2, H, "H6", "Kai Moreno", "pass", "middle_third", "complete", 40),
  mk(3, H, "H7", "Ravi Anand", "pass", "final_third", "complete", 40),
  mk(4, A, "A7", "Mateo Ruiz", "pressure", "own_third", "applied", 41),
  mk(5, H, "H9", "Theo Marchetti", "pass", "box", "complete", 41),
  mk(6, H, "H11", "Callum Pryce", "shot", "box", "goal", 41),
  mk(7, A, "A6", "Jack Thorne", "pass", "middle_third", "complete", 42),
  mk(8, A, "A10", "Ezra Cole", "pass", "final_third", "complete", 42),
  mk(9, A, "A9", "Leon Vogel", "shot", "box", "saved", 43),
  mk(10, H, "H4", "Marco Silveira", "tackle", "own_third", "won", 43),
];

export default function Landing() {
  const [evs, setEvs] = useState<Ev[]>(FALLBACK);
  useEffect(() => {
    fetch(`${API}/api/events`).then(r => r.json()).then(d => { if (Array.isArray(d?.events) && d.events.length) setEvs(d.events); }).catch(() => {});
  }, []);
  const base = useMemo(() => lineup(evs, H), [evs]);
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(v => v + 1), 780);
    return () => clearInterval(t);
  }, []);
  const cur = evs[i % evs.length];
  const frame = useSim(base, cur, H);
  const focus = useMemo(() => new Set([cur.player_id]), [cur]);
  const caption = cur.type === "shot" && cur.outcome !== "goal" ? `${cur.minute}' ${cur.player.split(" ").slice(-1)[0]} · ${cur.outcome.replace("_", " ")}` : undefined;

  return (
    <div className="landing">
      <div className="floodlights" aria-hidden><span /><span /><span /></div>

      <nav className="nav">
        <Link href="/" className="logo"><Mark /> PitchMind</Link>
        <div className="navlinks">
          <a href="#agents">Agents</a>
          <a href="#clubs">Clubs</a>
          <a href="#how">How it works</a>
          <a href="#stack">Built on</a>
        </div>
        <UserMenu />
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> Inside the Game · Match intelligence</div>
          <h1>Every insight.<br /><em>Proven</em> on the pitch.</h1>
          <p className="lede">
            PitchMind is a team of AI agents that watches the match, finds the story and checks
            every claim against raw events before it reaches the presenter.
          </p>
          <div className="hero-cta">
            <Link href="/club" className="cta">Build your club with AI <span>→</span></Link>
            <Link href="/dashboard" className="ghost">Watch a demo match</Link>
          </div>
          <div className="hero-facts">
            <div><b>6</b><span>agents in one team</span></div>
            <div><b>0</b><span>unchecked claims on air</span></div>
            <div><b>3</b><span>fan voices per note</span></div>
          </div>
        </div>

        <div className="hero-visual">
          <Pitch3D players={frame.players} ball={frame.ball} carrier={cur.player_id} focus={focus} caption={caption} goal={frame.goal ? { player: frame.goal.player, team: frame.goal.team, minute: frame.goal.minute } : null} auto tilt={58} />
          <div className="float-card fc1">
            <div className="fc-head"><span className="badge">✓ Proof verified</span><span>48'</span></div>
            <p>Northbridge fire three shots worth 0.66 xG in ten minutes. The pressure is building.</p>
          </div>
          <div className="float-card fc2">
            <div className="fc-head"><span className="badge bad">✕ Rejected</span><span>Analyst retry</span></div>
            <p>Claimed 5 shots. The events show 3. Sent back with feedback.</p>
          </div>
          <div className="agent-orbit">
            {AGENTS.map((a, k) => <span key={a.key} className={k === Math.floor(i / 3) % 5 ? "on" : ""}>{a.key}</span>)}
          </div>
        </div>
      </header>

      <section id="agents" className="section">
        <div className="section-head">
          <span className="eyebrow">The team</span>
          <h2>Six agents. One rule: no proof, no air.</h2>
        </div>
        <div className="agent-grid">
          {[...AGENTS, { key: "Scout", role: "Builds clubs", blurb: "Turns a manager's idea into a fictional club and squad of 11." }].map((a, k) => (
            <div key={a.key} className="agent-card">
              <div className="agent-num">0{k + 1}</div>
              <h3>{a.key}</h3>
              <div className="agent-role">{a.role}</div>
              <p>{a.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="clubs" className="section">
        <div className="section-head">
          <span className="eyebrow">Play with your crew</span>
          <h2>Your club. Your mates. AI on the mic.</h2>
        </div>
        <div className="flow">
          <div className="flow-step">
            <span className="step-n">🧠</span>
            <h3>Scout builds it</h3>
            <p>Describe your dream side. The Scout Agent drafts the badge, kit, style and a full squad of 11 invented players.</p>
            <code>"fearless harbour kids who press" → Power 74</code>
          </div>
          <div className="flow-step">
            <span className="step-n">🤝</span>
            <h3>Friends join</h3>
            <p>Share a six letter code. Up to 30 managers in one club, with a live club chat and shared history.</p>
            <code>invite code · F26E94</code>
          </div>
          <div className="flow-step">
            <span className="step-n">🏆</span>
            <h3>Battle and climb</h3>
            <p>Challenge rivals. Your squad shapes the match, the agents call it live, and wins push you up the trophy ladder.</p>
            <code>win +30 · draw +8 · loss −18</code>
          </div>
        </div>
      </section>

      <section id="how" className="section">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>From raw events to a line you can trust.</h2>
        </div>
        <div className="flow">
          <div className="flow-step">
            <span className="step-n">1</span>
            <h3>Watch</h3>
            <p>The Lead agent cuts the live feed into ten minute windows and hands each one to the Analyst.</p>
            <code>window 40–49 · 38 events</code>
          </div>
          <div className="flow-step">
            <span className="step-n">2</span>
            <h3>Prove</h3>
            <p>Proof checks each claim against the event log. Wrong numbers go back with feedback.</p>
            <code>shots = 3 · events #212 #219 #224 ✓</code>
          </div>
          <div className="flow-step">
            <span className="step-n">3</span>
            <h3>Tell</h3>
            <p>Story writes the on air line. Fans switch it to kids, tactical or casual. Recap writes full time.</p>
            <code>tone: broadcast · 24 words</code>
          </div>
        </div>
      </section>

      <section id="stack" className="section">
        <div className="section-head">
          <span className="eyebrow">Built on</span>
          <h2>Microsoft Foundry and Azure, end to end.</h2>
        </div>
        <div className="stack">
          {["Microsoft Foundry", "Agent Framework", "Azure OpenAI gpt-4o", "FastAPI live stream", "Next.js dashboard"].map(s => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <h2>Build your club and kick off.</h2>
        <div className="hero-cta center">
          <Link href="/club" className="cta">Build your club with AI <span>→</span></Link>
          <Link href="/dashboard" className="ghost">Watch a demo match</Link>
        </div>
      </section>

      <footer className="foot">
        Synthetic match data. Teams and players are fictional. Built for the Microsoft × Premier League Inside the Game hackathon.
      </footer>
    </div>
  );
}
