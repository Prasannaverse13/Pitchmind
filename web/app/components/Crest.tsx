import type { Club } from "../lib";

/** Club badge drawn from the club colours. */
export default function Crest({ club, size = 64 }: { club: Pick<Club, "short" | "colors">; size?: number }) {
  const { primary, secondary } = club.colors;
  return (
    <svg width={size} height={size * 1.12} viewBox="0 0 100 112" className="crestsvg" aria-hidden>
      <defs>
        <linearGradient id={`g${club.short}${primary.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={primary} />
          <stop offset="1" stopColor={secondary} />
        </linearGradient>
      </defs>
      <path d="M50 4 L92 18 V54 C92 80 72 98 50 108 C28 98 8 80 8 54 V18 Z" fill={`url(#g${club.short}${primary.slice(1)})`}
        stroke="rgba(255,255,255,.75)" strokeWidth="3" />
      <path d="M50 14 L82 25 V54 C82 74 67 88 50 97 C33 88 18 74 18 54 V25 Z" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="2" />
      <text x="50" y="66" textAnchor="middle" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight="800"
        fontSize="30" fill="#fff" style={{ paintOrder: "stroke" }} stroke="rgba(0,0,0,.35)" strokeWidth="3">{club.short}</text>
    </svg>
  );
}
