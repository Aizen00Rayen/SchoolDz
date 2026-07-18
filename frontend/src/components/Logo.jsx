import { useEffect, useState } from "react";

/**
 * Scolaris brand mark: a 3x3 node grid (perimeter + midpoints) wired to a
 * central square, with the top-right node picked out in the brand red. Same
 * geometry across LogoMark / Logo / LogoReveal so the icon never "jumps"
 * between the static and animated versions.
 */
const NODES = [
  { x: 24, y: 24, key: "tl" },
  { x: 80, y: 24, key: "tm" },
  { x: 136, y: 24, key: "tr", accent: true },
  { x: 24, y: 80, key: "ml" },
  { x: 136, y: 80, key: "mr" },
  { x: 24, y: 136, key: "bl" },
  { x: 80, y: 136, key: "bm" },
  { x: 136, y: 136, key: "br" },
];
const NODE_R = 13;
const CENTER = { x: 64, y: 64, size: 32 };
const LINES = [
  "M24,24 L136,24 L136,136 L24,136 Z", // perimeter
  "M80,24 L80,136", // vertical
  "M24,80 L136,80", // horizontal
  "M24,24 L136,136", // diagonal ↘
  "M24,136 L136,24", // diagonal ↗
];

export function LogoMark({ className = "", size = 32 }) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Scolaris"
    >
      {LINES.map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
      <rect x={CENTER.x} y={CENTER.y} width={CENTER.size} height={CENTER.size} rx={3} fill="currentColor" />
      {NODES.map((n) => (
        <circle key={n.key} cx={n.x} cy={n.y} r={NODE_R} fill={n.accent ? "hsl(var(--accent))" : "currentColor"} />
      ))}
    </svg>
  );
}

export function Logo({ className = "", size = 26, textClassName = "" }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span className={`font-display font-bold tracking-tight ${textClassName}`}>scolaris</span>
    </span>
  );
}

const REVEAL_SESSION_KEY = "scolaris_logo_reveal_seen";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One-time animated brand reveal: nodes pop in, connectors draw, the accent
 * node turns red, then the mark shifts left to make room for the wordmark.
 * Plays once per browser session (skips straight to the end state on repeat
 * visits within the session, and for prefers-reduced-motion) — this is a
 * brand moment, not a loading spinner.
 */
export function LogoReveal({ className = "", size = 44 }) {
  const [skip] = useState(() => {
    if (prefersReducedMotion()) return true;
    try {
      return sessionStorage.getItem(REVEAL_SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (skip) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(REVEAL_SESSION_KEY, "1");
      } catch {
        /* private-browsing / storage disabled — fine to replay next time */
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [skip]);

  if (skip) {
    return <Logo className={className} size={size} textClassName="text-2xl" />;
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        viewBox="0 0 160 160"
        width={size}
        height={size}
        role="img"
        aria-label="Scolaris"
      >
        {LINES.map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength={100}
            stroke="currentColor"
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            className="logo-reveal-line"
            style={{ animationDelay: `${0.25 + i * 0.05}s` }}
          />
        ))}
        <rect
          x={CENTER.x} y={CENTER.y} width={CENTER.size} height={CENTER.size} rx={3}
          fill="currentColor"
          className="logo-reveal-node"
          style={{ animationDelay: "0s" }}
        />
        {NODES.map((n, i) => (
          <circle
            key={n.key}
            cx={n.x} cy={n.y} r={NODE_R}
            fill="currentColor"
            className={n.accent ? "logo-reveal-node logo-reveal-accent" : "logo-reveal-node"}
            style={{ animationDelay: n.accent ? `${i * 0.045}s, 0.7s` : `${i * 0.045}s` }}
          />
        ))}
      </svg>
      <span className="font-display font-bold tracking-tight text-2xl logo-reveal-text">scolaris</span>
    </span>
  );
}
