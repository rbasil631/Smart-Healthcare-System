import { cn } from "cn"

/** The heart-with-ECG mark used in the header and on the sign-in card. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-9.5 shrink-0 items-center justify-center rounded-xl bg-linear-145 from-primary to-brand-deep shadow-[0_6px_14px_-6px_var(--primary)]",
        className
      )}
    >
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-6">
        <path
          d="M16 27.5s-10-5.9-12.6-11.9C1.6 11.3 4 5.8 9 5.8c3 0 5.2 1.8 7 4.2 1.8-2.4 4-4.2 7-4.2 5 0 7.4 5.5 5.6 9.8C26 21.6 16 27.5 16 27.5z"
          fill="#fff"
        />
        <path
          d="M5.5 16.2h5.2l2-4.2 3 8.4 2.2-5.6 1.6 1.4h6.7"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <BrandMark />
      <span className="flex flex-col leading-tight">
        <b className="text-base font-extrabold tracking-tight">
          Smart Healthcare System
        </b>
        <small className="text-xs font-semibold text-muted-foreground">
          for Heart Patients
        </small>
      </span>
    </span>
  )
}

/** The illustration beside the sign-in form: heart, stethoscope, bedside monitor. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 560 470"
      role="presentation"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="hg" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#FF7A88" />
          <stop offset=".55" stopColor="#E23B4E" />
          <stop offset="1" stopColor="#B01E33" />
        </linearGradient>
        <radialGradient id="glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".16" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tube" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F4F8FC" />
          <stop offset="1" stopColor="#BFD3E6" />
        </linearGradient>
      </defs>

      <circle cx="330" cy="280" r="190" fill="url(#glow)" />
      <circle
        cx="330"
        cy="280"
        r="150"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".10"
        strokeWidth="1.5"
      />
      <circle
        cx="330"
        cy="280"
        r="205"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".06"
        strokeWidth="1.5"
        strokeDasharray="4 8"
      />

      <g>
        <path
          d="M330 420C262 378 210 334 200 278c-9-50 22-96 72-96 27 0 45 14 58 34 13-20 31-34 58-34 50 0 81 46 72 96-10 56-62 100-130 142z"
          fill="url(#hg)"
        />
        <path
          d="M246 214c-22 8-34 30-30 56"
          fill="none"
          stroke="#fff"
          strokeOpacity=".45"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M214 296h46l14-30 20 62 16-44 10 12h76"
          fill="none"
          stroke="#fff"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      <g fill="none" strokeLinecap="round">
        <path
          d="M474 64c-4 40 6 70 30 92M520 58c4 40-4 70-16 98"
          stroke="url(#tube)"
          strokeWidth="7"
        />
        <circle cx="474" cy="60" r="7" fill="#F4F8FC" />
        <circle cx="520" cy="54" r="7" fill="#F4F8FC" />
        <path
          d="M504 156c10 60-4 126-52 178-38 41-92 66-146 70-52 4-96-10-118-40"
          stroke="url(#tube)"
          strokeWidth="10"
        />
        <circle
          cx="182"
          cy="356"
          r="30"
          fill="#F4F8FC"
          stroke="#BFD3E6"
          strokeWidth="6"
        />
        <circle cx="182" cy="356" r="13" fill="#D7E5F1" />
      </g>

      <g transform="translate(18 18)">
        <rect
          width="300"
          height="168"
          rx="18"
          fill="#061F36"
          stroke="#ffffff"
          strokeOpacity=".16"
        />
        <rect x="14" y="40" width="272" height="112" rx="8" fill="#04172A" />
        <g stroke="#2B5A7F" strokeOpacity=".35" strokeWidth="1">
          <path d="M14 68h272M14 96h272M14 124h272M68 40v112M122 40v112M176 40v112M230 40v112" />
        </g>
        <text
          x="16"
          y="27"
          fontSize="13"
          fontWeight="700"
          fill="#9FD0FF"
          fontFamily="inherit"
        >
          ECG II
        </text>
        <text
          x="284"
          y="28"
          textAnchor="end"
          fontSize="18"
          fontWeight="800"
          fill="#5BE3B0"
          fontFamily="inherit"
        >
          72 bpm
        </text>
        <path
          d="M14 104h30l8-10 8 10h10l6 8 9-58 9 76 6-26h18l12-12 12 12h22l8-10 8 10h10l6 8 9-58 9 76 6-26h18l12-12 12 12h17"
          fill="none"
          stroke="#13405F"
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <path
          d="M14 104h30l8-10 8 10h10l6 8 9-58 9 76 6-26h18l12-12 12 12h22l8-10 8 10h10l6 8 9-58 9 76 6-26h18l12-12 12 12h17"
          fill="none"
          stroke="#5BE3B0"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={800}
          strokeDasharray="120 680"
          className="motion-safe:[animation:hero-sweep_3.2s_linear_infinite]"
        />
      </g>

      <g fill="#ffffff" fillOpacity=".35">
        <path d="M520 300h6v8h8v6h-8v8h-6v-8h-8v-6h8z" />
        <path d="M108 250h4v6h6v4h-6v6h-4v-6h-6v-4h6z" />
        <path d="M470 420h5v7h7v5h-7v7h-5v-7h-7v-5h7z" />
      </g>

      <style>{`@keyframes hero-sweep { from { stroke-dashoffset: 800 } to { stroke-dashoffset: 0 } }`}</style>
    </svg>
  )
}
