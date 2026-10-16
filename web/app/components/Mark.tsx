export default function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
      <defs>
        <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ddc84" /><stop offset="1" stopColor="#4d6bff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#mk)" />
      <circle cx="16" cy="16" r="6" fill="none" stroke="#06130c" strokeWidth="2" />
      <path d="M16 2 V30" stroke="#06130c" strokeWidth="2" />
      <circle cx="16" cy="16" r="1.8" fill="#06130c" />
    </svg>
  );
}
