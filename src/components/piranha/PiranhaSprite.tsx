import { memo } from 'react';
// ─────────────────────────────────────────────────────────────────────────────
// The piranha sprite — gradients + the four body parts, defined ONCE.
//
// Every fish is a set of <use> references into this. Render it twice and the
// duplicate `id`s silently break every url(#…) reference in the document, so
// <Swarm> guards against that; nothing else should mount it.
//
// The fish faces right, drawn in a 220×165 viewBox. Every magic number here is in
// those units — the jaw hinge at 166,91 and the bite origin at 206,84 are relied on
// by swarm.css. Don't rescale the paths; scale the <g> around them.
// ─────────────────────────────────────────────────────────────────────────────

export const PiranhaSprite = memo(function PiranhaSprite() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="pzBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF7A4C" /><stop offset="26%" stopColor="#F04A22" />
          <stop offset="62%" stopColor="#C22812" /><stop offset="100%" stopColor="#6E0F05" />
        </linearGradient>
        <linearGradient id="pzJaw" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B32410" /><stop offset="100%" stopColor="#F0562C" />
        </linearGradient>
        <linearGradient id="pzFin" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#D42D14" /><stop offset="100%" stopColor="#5C0C04" />
        </linearGradient>
        <linearGradient id="pzTooth" x1="0.15" y1="0" x2="0.75" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" /><stop offset="42%" stopColor="#EEF3F7" />
          <stop offset="100%" stopColor="#AEBCC8" />
        </linearGradient>
        {/* The mouth is gum, not a void. A dark fill behind white teeth reads as a hole
            punched through the head, however the shape is drawn. */}
        <linearGradient id="pzMouth" x1="0.1" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#D4381E" /><stop offset="55%" stopColor="#A81C0C" />
          <stop offset="100%" stopColor="#7A1207" />
        </linearGradient>
        <radialGradient id="pzIris" cx="0.36" cy="0.32" r="0.8">
          <stop offset="0%" stopColor="#EAFDFF" /><stop offset="22%" stopColor="#67E6FA" />
          <stop offset="52%" stopColor="#22D3EE" /><stop offset="80%" stopColor="#0A7D94" />
          <stop offset="100%" stopColor="#04222A" />
        </radialGradient>
        <linearGradient id="pzGloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity=".36" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>

        {/* the tail sweeps on its own clock, so it lives apart from the body */}
        <g id="pzTail">
          <path fill="url(#pzFin)" d="M32,60 L4,32 L18,82 L4,132 L32,104 Z" />
          <path fill="#4A0903" opacity=".5" d="M18,82 L4,32 L14,80 Z" />
        </g>

        <g id="pzBodyG">
          <path fill="url(#pzFin)" d="M112,27 L96,2 L80,32 Z" />
          <path fill="url(#pzFin)" d="M72,35 L62,15 L58,41 Z" />
          <path fill="#5C0C04" d="M48,46 L42,33 L38,51 Z" />
          <path fill="url(#pzFin)" d="M74,128 L82,154 L96,133 Z" />
          <path fill="url(#pzFin)" d="M112,136 L116,151 L128,132 Z" />
          <path fill="url(#pzMouth)" d="M206,70 L166,86 C170,94 184,98 204,100 Z" />
          <path
            fill="url(#pzBody)"
            d="M206,70 C190,55 174,45 158,38 C136,27 106,25 84,32 C62,39 44,49 32,60
               L32,104 C46,118 64,128 86,133 C112,139 142,131 162,116 L164,98 L166,86 Z"
          />
          {/* The jaw socket. Without it there is a wedge of nothing between the chin and
              the jaw's rear corner, and the page shows through it as the mouth opens. */}
          <path fill="#A81C0C" d="M148,84 C166,88 176,100 174,120 C162,126 150,114 146,98 Z" />
          <g fill="none" stroke="#5E0D04" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round">
            <path d="M142,36 C132,62 132,100 144,124" /><path d="M114,28 C102,58 102,102 116,132" />
            <path d="M86,30 C74,58 74,100 88,131" /><path d="M58,41 C48,63 48,97 60,121" />
          </g>
          <path
            fill="url(#pzGloss)"
            d="M186,54 C166,40 132,30 100,30 C76,30 54,42 38,58 C58,42 80,36 102,37 C136,38 168,44 186,54 Z"
          />

          {/* Gill slits: bevel, groove, then the current burning INSIDE, trimmed to the
              groove's own path with a dash offset so it can never drift out of the slit.
              A halo stroke fakes the glow — an SVG blur filter costs a pass per fish per
              frame, and this lives in the header forever. */}
          <g fill="none" strokeLinecap="round">
            <g stroke="#7A1207" strokeOpacity=".5" strokeWidth="9.5">
              <path d="M130,52 C122,68 122,90 132,104" /><path d="M119,54 C111,69 111,89 121,102" />
              <path d="M109,57 C102,71 102,87 111,99" />
            </g>
            <g stroke="#2E0601" strokeWidth="6.4">
              <path d="M130,52 C122,68 122,90 132,104" /><path d="M119,54 C111,69 111,89 121,102" />
              <path d="M109,57 C102,71 102,87 111,99" />
            </g>
            <g stroke="#22D3EE" strokeOpacity=".22" strokeWidth="6.5"
               pathLength={100} strokeDasharray="72 100" strokeDashoffset={-14}>
              <path d="M130,52 C122,68 122,90 132,104" /><path d="M119,54 C111,69 111,89 121,102" />
              <path d="M109,57 C102,71 102,87 111,99" />
            </g>
            <g stroke="#22D3EE" strokeWidth="2.5"
               pathLength={100} strokeDasharray="72 100" strokeDashoffset={-14}>
              <path d="M130,52 C122,68 122,90 132,104" /><path d="M119,54 C111,69 111,89 121,102" />
              <path d="M109,57 C102,71 102,87 111,99" />
            </g>
          </g>

          <path fill="#8E1508" d="M156,104 L146,125 L170,110 Z" />
          <circle cx="148" cy="64" r="14.5" fill="#1C0603" />
          <circle cx="148" cy="64" r="12.6" fill="#3B0A04" />
          <circle cx="148" cy="64" r="11" fill="url(#pzIris)" />
          <circle cx="150" cy="65.5" r="4.6" fill="#031117" />
          <circle cx="143.5" cy="58.5" r="3.1" fill="#FFFFFF" opacity=".92" />
          {/* the brow overhangs the eye — that's the anger */}
          <path fill="#8E1508" d="M134,51 C144,47 160,49 170,60 L165,66 C156,56 144,53 135,57 Z" />
        </g>

        {/* the only moving part. Hinged at 166,91 — see swarm.css */}
        <g id="pzJawG">
          <path fill="url(#pzJaw)" d="M205,76 L166,91 L162,108 C180,118 201,112 210,88 Z" />
          <path fill="#FF8C5E" opacity=".26" d="M204,92 L166,101 L165,105 C180,109 197,104 207,92 Z" />
          <path fill="#8E1508" d="M205,76 L166,91 L166,88 L205,73 Z" />
          <g fill="url(#pzTooth)">
            <path d="M205,76 L198.5,78.5 L202.8,63.3 Z" /><path d="M198.5,78.5 L192,81 L196.3,67.8 Z" />
            <path d="M192,81 L185.4,83.5 L189.7,67.3 Z" /><path d="M185.4,83.5 L178.9,86.1 L183.2,73.8 Z" />
            <path d="M178.9,86.1 L172.3,88.6 L176.6,74.4 Z" /><path d="M172.3,88.6 L166,91 L170.2,78.8 Z" />
          </g>
        </g>

        {/* drawn LAST so the upper fangs hang over the jaw — the underbite read */}
        <g id="pzFangs">
          <path fill="#8E1508" d="M206,70 L166,86 L167,89 L207,73 Z" />
          <g fill="url(#pzTooth)">
            <path d="M205.8,70.1 L198.8,72.9 L203.8,86.5 Z" /><path d="M198.8,72.9 L191.8,75.7 L196.8,86.8 Z" />
            <path d="M191.8,75.7 L184.8,78.5 L189.8,93.1 Z" /><path d="M184.8,78.5 L177.9,81.2 L182.9,92.9 Z" />
            <path d="M177.9,81.2 L170.9,84 L175.9,97.6 Z" /><path d="M170.9,84 L166,86 L170,97 Z" />
          </g>
        </g>
      </defs>
    </svg>
  );
});
