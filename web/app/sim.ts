"use client";

// Movement engine. Turns discrete synthetic events into continuous play:
// the ball travels between event locations, both teams shift their shape with
// the ball, the nearest opponents press, and the ball carrier runs onto it.

import { useEffect, useRef, useState } from "react";
import type { Ev, Player } from "./lib";

export type SimPlayer = Player & { run: boolean };
export type Ball = { x: number; y: number; z: number };
export type Frame = { players: SimPlayer[]; ball: Ball | null; goal: Ev | null };

const DEPTH: Record<string, number> = { own_third: 24, middle_third: 50, final_third: 72, box: 88 };

function rand(seed: number) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Where the ball is for an event, in pitch units (0..100 both ways). */
function spotFor(e: Ev, carrier: Player | undefined, home: string): { x: number; y: number } {
  const dir = e.team === home ? 1 : -1;
  const d = (DEPTH[e.zone] ?? 50) + (rand(e.id) - 0.5) * 10;
  const x = dir > 0 ? d : 100 - d;
  let y = (carrier?.y ?? 50) + (rand(e.id + 7) - 0.5) * 18;
  if (e.zone === "box") y = 50 + (y - 50) * 0.45;
  return { x, y: Math.max(6, Math.min(94, y)) };
}

/** Where a shot ends up. */
function shotEnd(e: Ev, from: { x: number; y: number }, home: string) {
  const dir = e.team === home ? 1 : -1;
  const gx = dir > 0 ? 100.5 : -0.5;
  const j = (rand(e.id + 3) - 0.5);
  if (e.outcome === "goal") return { x: gx, y: 50 + j * 7 };
  if (e.outcome === "saved") return { x: dir > 0 ? 97 : 3, y: 50 + j * 6 };
  if (e.outcome === "off_target") return { x: gx + dir * 2, y: 50 + (j > 0 ? 1 : -1) * (9 + Math.abs(j) * 8) };
  return { x: from.x + (gx - from.x) * 0.35, y: from.y + (50 - from.y) * 0.3 }; // blocked
}

type Tween = { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number; arc: number;
  then?: { tx: number; ty: number; dur: number; arc: number } };

export function useSim(base: Player[], cur: Ev | null, home: string): Frame {
  const pos = useRef(new Map<string, { x: number; y: number; sp: number }>());
  const ball = useRef<Ball | null>(null);
  const tw = useRef<Tween | null>(null);
  const curRef = useRef<Ev | null>(null);
  const goalRef = useRef<{ e: Ev; until: number } | null>(null);
  const [frame, setFrame] = useState<Frame>({ players: base.map(p => ({ ...p, run: false })), ball: null, goal: null });

  // Reset positions when the line up changes.
  useEffect(() => {
    pos.current = new Map(base.map(p => [p.id, { x: p.x, y: p.y, sp: 0 }]));
  }, [base]);

  // New event: start the ball moving to its new spot.
  useEffect(() => {
    curRef.current = cur;
    if (!cur) { tw.current = null; ball.current = null; return; }
    const carrier = base.find(p => p.id === cur.player_id);
    const zone = spotFor(cur, carrier, home);
    // Aim for where the named player really is, so the pass visibly goes to him.
    const at = pos.current.get(cur.player_id);
    const bl = cur.type === "shot" ? 0.6 : 0.35;
    const to = at ? { x: zone.x + (at.x - zone.x) * bl, y: zone.y + (at.y - zone.y) * bl } : zone;
    const now = performance.now();
    const from = ball.current ?? { x: 50, y: 50, z: 0 };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const t: Tween = { fx: from.x, fy: from.y, tx: to.x, ty: to.y, t0: now, dur: Math.min(620, 220 + dist * 9), arc: dist > 22 ? dist * 0.35 : 2 };
    if (cur.type === "shot") {
      const end = shotEnd(cur, to, home);
      t.then = { tx: end.x, ty: end.y, dur: 260, arc: cur.outcome === "off_target" ? 14 : 6 };
      if (cur.outcome === "goal") goalRef.current = { e: cur, until: now + 2600 };
    }
    tw.current = t;
    if (!ball.current) ball.current = { x: to.x, y: to.y, z: 0 };
  }, [cur, base, home]);

  // Frame loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Ball.
      const t = tw.current;
      if (t && ball.current) {
        let k = (now - t.t0) / t.dur;
        if (k >= 1 && t.then) {
          tw.current = { fx: t.tx, fy: t.ty, tx: t.then.tx, ty: t.then.ty, t0: now, dur: t.then.dur, arc: t.then.arc };
          k = 0;
        }
        const tt = tw.current!;
        const kk = Math.max(0, Math.min(1, (now - tt.t0) / tt.dur));
        const e = 1 - Math.pow(1 - kk, 2);
        ball.current = { x: tt.fx + (tt.tx - tt.fx) * e, y: tt.fy + (tt.ty - tt.fy) * e, z: Math.sin(Math.PI * kk) * tt.arc };
      }

      // Players.
      const b = ball.current;
      const ev = curRef.current;
      const attHome = ev ? ev.team === home : true;
      const pressers = new Set<string>();
      if (b && ev) {
        const opp = base.filter(p => (p.side === "home") !== attHome && p.num !== "1");
        opp
          .map(p => ({ id: p.id, d: Math.hypot((pos.current.get(p.id)?.x ?? p.x) - b.x, (pos.current.get(p.id)?.y ?? p.y) - b.y) }))
          .sort((a, c) => a.d - c.d)
          .slice(0, 2)
          .forEach(p => pressers.add(p.id));
      }
      const out: SimPlayer[] = [];
      for (const p of base) {
        const s = pos.current.get(p.id) ?? { x: p.x, y: p.y, sp: 0 };
        let tx = p.x, ty = p.y, max = 11;
        const mine = (p.side === "home") === attHome;
        const dir = p.side === "home" ? 1 : -1;
        if (b) {
          if (p.num === "1") {
            tx = p.x + dir * Math.max(0, (dir > 0 ? b.x : 100 - b.x) - 70) * -0.05;
            ty = 50 + (b.y - 50) * 0.25;
          } else {
            tx = p.x + (b.x - 50) * 0.7 + (mine ? dir * 8 : -dir * 3);
            ty = p.y + (b.y - 50) * 0.32;
            ty = 50 + (ty - 50) * (mine ? 1.05 : 0.82); // attack stretches, defence narrows
          }
          if (ev && p.id === ev.player_id) {
            const back = dir * -1.6;
            tx = b.x + back; ty = b.y + 1.2; max = 60;
          } else if (pressers.has(p.id)) {
            tx = b.x + dir * -2.5; ty = b.y + (p.y > b.y ? 2.2 : -2.2); max = 20;
          }
        }
        // Small idle sway so nobody stands frozen.
        const ph = p.id.charCodeAt(1) * 1.7 + p.id.length;
        tx += Math.sin(now / 900 + ph) * 0.7;
        ty += Math.cos(now / 1100 + ph) * 0.7;
        tx = Math.max(1.5, Math.min(98.5, tx));
        ty = Math.max(3, Math.min(97, ty));

        const dx = tx - s.x, dy = ty - s.y;
        const d = Math.hypot(dx, dy);
        const mv = Math.min(d, Math.max(d * 2.4 * dt, 0), max * dt);
        if (d > 0.001) { s.x += (dx / d) * mv; s.y += (dy / d) * mv; }
        s.sp = s.sp * 0.8 + (mv / Math.max(dt, 0.001)) * 0.2;
        pos.current.set(p.id, s);
        out.push({ ...p, x: s.x, y: s.y, run: s.sp > 3.2 });
      }

      const g = goalRef.current && goalRef.current.until > now ? goalRef.current.e : null;

      acc += dt;
      if (acc >= 1 / 40) { // render at ~40 fps
        acc = 0;
        setFrame({ players: out, ball: b ? { ...b } : null, goal: g });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [base, home]);

  return frame;
}
