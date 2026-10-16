"use client";

// Live commentary. Two layers, like a real broadcast:
//  1. Play by play: instant calls built straight from the event data (no AI, always true).
//  2. Colour: the Story agent's Proof verified notes, spoken as they arrive.

import { useCallback, useEffect, useRef } from "react";
import type { Ev } from "./lib";

export type Line = { id: string; minute: number; text: string; kind: "pbp" | "note" | "goal" | "ft" };

const pick = (e: Ev, xs: string[]) => xs[(e.id * 7 + e.minute) % xs.length];
const last = (n: string) => n.split(" ").slice(-1)[0];
const club = (t: string) => t.split(" ")[0];

export type Call = { text: string; speak: boolean; goal?: boolean; hype?: number };
export type Ctx = { prev: Ev | null; score: [number, number]; home: string; away: string };

/**
 * Play by play. One short, lively call per event, built only from what really happened,
 * and aimed at what the pitch is showing: the named player is the one who has the ball now.
 */
export function callFor(e: Ev, ctx: Ctx): Call | null {
  const p = last(e.player);
  const T = club(e.team);
  const prev = ctx.prev;
  const prevP = prev ? last(prev.player) : "";
  const chain = !!prev && prev.type === "pass" && prev.outcome === "complete" && prev.team === e.team && prev.player_id !== e.player_id;
  const k = (e.id + e.minute) % 3; // thins out the routine calls so it never feels like a stream

  switch (e.type) {
    case "shot": {
      if (e.outcome === "goal") {
        const [h, a] = ctx.score;
        const lead = h === a ? `All square, ${h} ${a}.` : `${club(h > a ? ctx.home : ctx.away)} lead ${Math.max(h, a)} ${Math.min(h, a)}.`;
        return { goal: true, speak: true, hype: 3, text: `${pick(e, [
          `GOOOAL! ${p} buries it!`,
          `It's in! ${p} with an absolute rocket!`,
          `${p}! Sensational! What a finish!`,
          `Back of the net! ${p} scores!`,
        ])} ${lead}` };
      }
      if (e.outcome === "saved")
        return { speak: true, hype: 2, text: pick(e, [`${p} shoots, and it's saved! Great stop!`, `What a save! ${p} is denied!`, `The keeper says no to ${p}!`, `${p} tests the gloves. Held!`]) };
      if (e.outcome === "blocked")
        return { speak: true, hype: 1, text: pick(e, [`${p} lets fly... blocked!`, `Bodies on the line! ${p} is blocked.`, `${p} fires, but a defender gets in the way!`]) };
      return { speak: true, hype: 1, text: pick(e, [`${p} goes for glory... and it's wide!`, `Oh, that's gone miles over, ${p}!`, `${p} will want that one back!`]) };
    }
    case "tackle":
      if (e.outcome !== "won") return null;
      if (e.zone === "middle_third" && k) return null;
      return { speak: true, hype: 1, text: pick(e, [`Crunching tackle from ${p}!`, `${p} wins it back, cheeky!`, `In steps ${p}. Ball won!`, `Strong challenge by ${p}!`]) };
    case "foul":
      return { speak: true, hype: 1, text: pick(e, [`Whistle! ${p} gives away a free kick.`, `Foul on ${p}... the ref isn't happy.`, `${p} was a bit naughty there. Free kick.`]) };
    case "possession_change":
      if (e.zone !== "final_third" && e.zone !== "box") return null;
      return { speak: k === 0, text: pick(e, [`Sloppy! ${T} give it away.`, `${T} lose it in a dangerous spot!`]) };
    case "pressure":
      if (e.zone !== "box" && e.zone !== "final_third") return null;
      return { speak: k !== 1, text: pick(e, [`${p} is hunting them down!`, `${T} pressing high, no time to breathe!`, `${p} closes down fast!`]) };
    case "pass": {
      if (e.outcome === "incomplete") {
        if (e.zone === "own_third" || e.zone === "middle_third" || k) return null;
        return { speak: true, text: pick(e, [`${p} overhits it, out of play.`, `Misplaced pass from ${p}.`]) };
      }
      if (e.zone === "box") {
        return { speak: true, hype: 1, text: chain
          ? pick(e, [`${prevP} threads it to ${p} in the box!`, `${prevP} finds ${p} in the area, danger here!`])
          : pick(e, [`${p} slips it into the box!`, `${p} has space in the area!`]) };
      }
      if (chain && k !== 2) {
        return { speak: k === 0, text: pick(e, [`${prevP} finds ${p}.`, `${prevP} to ${p}, lovely.`, `${prevP} slides it to ${p}.`, `${p} takes it from ${prevP}.`]) };
      }
      if (!prev && e.minute === 0) return { speak: true, text: `And we're off! ${T} get us underway.` };
      return null;
    }
  }
  return null;
}

/** Trim an agent note so it can be said in a few seconds. */
export function shortNote(note: string): string {
  let t = note.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  const first = t.split(/(?<=[.!?])\s/)[0] || t;
  t = first.length >= 24 ? first : t;
  const words = t.split(" ");
  if (words.length > 15) {
    const cut = t.slice(0, t.split(" ").slice(0, 15).join(" ").length);
    const comma = Math.max(cut.lastIndexOf(","), cut.lastIndexOf("—"), cut.lastIndexOf("-"));
    t = (comma > 24 ? cut.slice(0, comma) : cut).replace(/[,\s-—]+$/, "") + ".";
  }
  return t;
}

/** Browser voice. Goals interrupt, notes queue, small calls are skipped if the commentator is busy. */
export function useVoice(enabled: boolean) {
  const voice = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const choose = () => {
      const vs = window.speechSynthesis.getVoices();
      const prefs = [/Ryan.*Natural/i, /Natural.*United Kingdom/i, /UK English Male/i, /en-GB/i, /English/i];
      for (const re of prefs) {
        const v = vs.find(x => re.test(`${x.name} ${x.lang}`));
        if (v) { voice.current = v; return; }
      }
    };
    choose();
    window.speechSynthesis.onvoiceschanged = choose;
  }, []);

  useEffect(() => {
    if (!enabled && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [enabled]);

  // Every call replaces whatever is still being said, so the voice can never run behind the pitch.
  return useCallback((text: string, level: "call" | "note" | "goal", hooks?: Hooks, force = false, hype = 0) => {
    if ((!enabled && !force) || typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    const s = window.speechSynthesis;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice.current) u.voice = voice.current;
    u.rate = level === "goal" ? 1.18 : hype >= 2 ? 1.15 : 1.1;
    u.pitch = level === "goal" ? 1.4 : hype >= 2 ? 1.2 : hype === 1 ? 1.08 : 1;
    u.volume = 1;
    if (hooks?.onstart) u.onstart = hooks.onstart;
    if (hooks?.onend) { u.onend = hooks.onend; u.onerror = hooks.onend; }
    s.speak(u);
    return true;
  }, [enabled]);
}

export type Hooks = { onstart?: () => void; onend?: () => void };

export const voiceBusy = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending) && !window.speechSynthesis.paused;
export const pauseVoice = () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.pause(); };
export const resumeVoice = () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.resume(); };
export const stopVoice = () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); };

/** Short stadium style beeps for the countdowns. */
export function beep(freq: number, dur: number) {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = ((beep as any).ctx ||= new AC()) as AudioContext;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur + 0.02);
  } catch { /* sound is optional */ }
}
