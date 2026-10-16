"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Mark from "../components/Mark";
import { api, getUser, setUser } from "../lib";

const AVATARS = ["#3ddc84", "#5ac8fa", "#ffd166", "#ff8a5b", "#ef476f", "#b28cff", "#c6ff4a", "#06d6a0"];

export default function Login() {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (getUser()) window.location.replace("/club"); }, []);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const d = await api<{ user: any }>("/api/auth/login", { method: "POST", body: JSON.stringify({ name, avatar }) });
      setUser(d.user);
      window.location.href = "/club";
    } catch (ex: any) { setErr(ex.message); setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="floodlights" aria-hidden><span /><span /><span /></div>
      <Link href="/" className="logo authlogo"><Mark /> PitchMind</Link>
      <form className="authcard glass" onSubmit={go}>
        <div className="eyebrow">Manager sign in</div>
        <h1>Step into the tunnel</h1>
        <p className="muted big2">Pick a manager name. Build a club with AI, bring your mates in with a code, and climb the trophy ladder.</p>

        <label className="fl">Manager name</label>
        <input className="inp" autoFocus value={name} maxLength={24} onChange={e => setName(e.target.value)} placeholder="e.g. Prasanna" />

        <label className="fl">Your colour</label>
        <div className="avas">
          {AVATARS.map(c => (
            <button type="button" key={c} className={"ava" + (c === avatar ? " on" : "")} style={{ background: c }}
              onClick={() => setAvatar(c)} aria-label={`Colour ${c}`}>
              {c === avatar ? (name.trim()[0] || "P").toUpperCase() : ""}
            </button>
          ))}
        </div>

        {err && <div className="err">{err}</div>}
        <button className="cta wide" disabled={busy || name.trim().length < 2}>{busy ? "Opening the gates..." : "Enter the stadium"} <span>→</span></button>
        <p className="muted tiny">Demo sign in, no password. Same name on another device opens the same manager. All clubs and players are fictional.</p>
      </form>
    </div>
  );
}
