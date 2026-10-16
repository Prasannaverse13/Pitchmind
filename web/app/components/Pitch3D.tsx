"use client";

import { useEffect, useRef, useState } from "react";
import type { Player } from "../lib";
import type { Ball } from "../sim";
import Stadium, { type Board } from "./Stadium";

type P = Player & { run?: boolean };
type Props = {
  players: P[];
  ball?: Ball | null;
  carrier?: string | null;          // player id on the ball
  focus?: Set<string>;              // players cited by the latest verified insight
  caption?: string;                 // short call shown over the ball
  goal?: { player: string; team: string; minute: number } | null;
  auto?: boolean;                   // slow camera sway for the landing hero
  tilt?: number;
  board?: Board;                    // live score for the big screen
  arena?: string;
  stadium?: boolean;                // draw the stands, roof and floodlights
};

/** A 3D pitch built with CSS transforms. Drag to orbit. No WebGL needed. */
export default function Pitch3D({ players, ball, carrier, focus, caption, goal, auto, tilt = 56, board, arena, stadium = true }: Props) {
  const [rz, setRz] = useState(auto ? -12 : -8);
  const drag = useRef<{ x: number; rz: number } | null>(null);

  useEffect(() => {
    if (!auto) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = (t: number) => {
      setRz(-10 + Math.sin((t - t0) / 3200) * 14);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [auto]);

  return (
    <div
      className={"stage" + (auto ? " auto" : "") + (stadium ? " stadium" : "") + (goal ? " roar" : "")}
      style={{ ["--rz" as any]: `${rz}deg`, ["--tilt" as any]: `${tilt}deg` }}
      onPointerDown={e => { if (!auto) drag.current = { x: e.clientX, rz }; }}
      onPointerMove={e => {
        if (!drag.current) return;
        setRz(Math.max(-40, Math.min(40, drag.current.rz + (e.clientX - drag.current.x) / 6)));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      <div className="plane">
        <svg className="lines" viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden>
          <defs>
            <pattern id="mow" width="10.5" height="68" patternUnits="userSpaceOnUse">
              <rect width="5.25" height="68" fill="rgba(255,255,255,0.035)" />
            </pattern>
          </defs>
          <rect width="105" height="68" fill="url(#mow)" />
          <g fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.35">
            <rect x="1" y="1" width="103" height="66" />
            <line x1="52.5" y1="1" x2="52.5" y2="67" />
            <circle cx="52.5" cy="34" r="9.15" />
            <rect x="1" y="13.85" width="16.5" height="40.3" />
            <rect x="87.5" y="13.85" width="16.5" height="40.3" />
            <rect x="1" y="24.85" width="5.5" height="18.3" />
            <rect x="98.5" y="24.85" width="5.5" height="18.3" />
            <path d="M17.5 26.7 A9.15 9.15 0 0 1 17.5 41.3" />
            <path d="M87.5 26.7 A9.15 9.15 0 0 0 87.5 41.3" />
          </g>
          <circle cx="52.5" cy="34" r="0.5" fill="#fff" />
        </svg>
        <div className="goalpost left" />
        <div className="goalpost right" />
        {stadium ? <Stadium board={board} arena={arena} /> : <div className="slab" />}

        {players.map(p => (
          <div key={p.id} className="shadow" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
        ))}
        {ball && <div className="ballshadow" style={{ left: `${ball.x}%`, top: `${ball.y}%`, opacity: Math.max(0.25, 1 - ball.z / 20) }} />}

        {players.map(p => {
          const on = focus?.has(p.id);
          const has = p.id === carrier;
          return (
            <div
              key={p.id}
              className={`player ${p.side}${p.num === "1" ? " gk" : ""}${on ? " focus" : ""}${has ? " ball" : ""}${p.run ? " run" : ""}`}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <div className="sprite">
                {(on || has) && <div className="tag">{p.name}</div>}
                <svg viewBox="0 0 40 52" className="kit" aria-hidden>
                  <circle cx="20" cy="7" r="6" className="head" />
                  <rect x="11" y="38" width="8" height="12" rx="2" className="leg l1" />
                  <rect x="21" y="38" width="8" height="12" rx="2" className="leg l2" />
                  <path d="M8 16 L14 13 L26 13 L32 16 L38 26 L32 29 L30 24 L30 40 L10 40 L10 24 L8 29 L2 26 Z" className="shirt" />
                  <text x="20" y="33" textAnchor="middle" className="num">{p.num}</text>
                </svg>
              </div>
            </div>
          );
        })}

        {ball && (
          <div className="ball3d" style={{ left: `${ball.x}%`, top: `${ball.y}%` }}>
            <div className="sprite"><div className="orb" style={{ transform: `translateY(${-ball.z * 1.6}px)` }} /></div>
          </div>
        )}
        {ball && caption && (
          <div className="callout" style={{ left: `${ball.x}%`, top: `${ball.y}%` }}>
            <div className="sprite"><div className="bubble">{caption}</div></div>
          </div>
        )}
      </div>

      {goal && (
        <div className="goalflash">
          <div className="gf-word">GOAL</div>
          <div className="gf-sub">{goal.minute}' {goal.player} · {goal.team}</div>
        </div>
      )}
      {!auto && <div className="orbit-hint">Drag to orbit</div>}
    </div>
  );
}
