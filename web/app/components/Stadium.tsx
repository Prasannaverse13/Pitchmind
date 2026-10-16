// The 3D stadium around the pitch. Pure CSS 3D, lives inside the pitch plane so it
// tilts and orbits with it. Four raked stands with crowds in the club colours,
// a translucent roof, LED ad boards, four floodlight towers, a big screen with the live score,
// and a plaza with trees around the outside.

export type Board = { home: string; away: string; hs: number; as: number; clock: string };

type Side = { k: "far" | "right" | "near" | "left"; rot: number; long: boolean };
const SIDES: Side[] = [
  { k: "far", rot: 0, long: true },
  { k: "right", rot: 90, long: false },
  { k: "near", rot: 180, long: true },
  { k: "left", rot: 270, long: false },
];
const TOWERS = [
  { k: "tl", rot: -45 }, { k: "tr", rot: 45 },
];
const TREES: [number, number][] = [
  [-12, 128], [8, 131], [26, 132], [74, 132], [92, 131], [112, 128],
  [-25, 20], [-25, 78], [125, 20], [125, 78],
];
const ADS = "PITCHMIND · PROOF VERIFIED · MICROSOFT FOUNDRY · AGENT FRAMEWORK · AZURE · ";

export default function Stadium({ board, arena = "PitchMind Arena" }: { board?: Board; arena?: string }) {
  return (
    <>
      <div className="apron" aria-hidden><div className="apron-side" /></div>
      <div className="floodglow" aria-hidden />

      {SIDES.map(s => (
        <div key={s.k} className={`side ${s.k} ${s.long ? "long" : "short"}`} style={{ transform: `rotateZ(${s.rot}deg)` }} aria-hidden>
          <div className="adboard"><span>{s.k === "near" ? "" : ADS + ADS}</span></div>
          <div className="seats"><div className="crowd" /><div className="aisles" /></div>
          <div className="backwall">
            {s.k === "near" ? <div className="arena-sign">{arena}</div> : <div className="vip" />}
          </div>
          {s.k !== "near" && <div className="roof" />}
          {s.k === "far" && board && (
            <div className="jumbo">
              <div className="j-team">{board.home}</div>
              <div className="j-score">{board.hs}<i>:</i>{board.as}</div>
              <div className="j-team">{board.away}</div>
              <div className="j-clock">{board.clock}</div>
            </div>
          )}
        </div>
      ))}

      {TOWERS.map(t => (
        <div key={t.k} className={`tower ${t.k}`} aria-hidden>
          <div className="tower-rot" style={{ transform: `rotateZ(${t.rot}deg)` }}>
            <div className="pole" />
            <div className="lamp"><span /></div>
          </div>
        </div>
      ))}

      {TREES.map(([x, y], i) => (
        <div key={i} className="tree" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden>
          <div className="sprite">
            <svg viewBox="0 0 24 34" width="20" height="28">
              <rect x="10.5" y="24" width="3" height="9" rx="1" fill="#6b4a2b" />
              <circle cx="12" cy="13" r="10" fill="#2f9e57" />
              <circle cx="8" cy="10" r="5" fill="#45c06f" />
            </svg>
          </div>
        </div>
      ))}
    </>
  );
}
