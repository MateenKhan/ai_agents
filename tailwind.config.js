/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Piranha brand accent (red #FF3B1D). `accent-*` IS the brand ramp — there is no
        // separate `brand-*` alias (it was a byte-identical duplicate and was removed).
        // A re-theme is one edit here. Semantic status/error colours (rose for errors, the
        // board lane hues, `ai-*`) stay separate and are deliberately NOT this red.
        accent: {
          50: '#fff1ee', 100: '#ffe0d9', 200: '#ffc2b3', 300: '#ff9a83', 400: '#ff6a4d',
          500: '#ff3b1d', 600: '#e62e12', 700: '#bf2410', 800: '#991f13', 900: '#7e1d15', 950: '#450a05',
        },
        // Semantic category hue for AI/agent surfaces: skills, merge commits, the review
        // role, schedule badges. Deliberately NOT the brand accent — it marks "this is the
        // machine's doing", never an action's danger level.
        ai: {
          50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa',
          500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95', 950: '#2e1065',
        },
        // Dark "terminal" surfaces — were scattered as raw hex (#0d1117 / #080e1d / …). Tokenized
        // so every console/log/monitor shares ONE source of truth.
        surface: {
          terminal: '#0d1117',   // log console body
          console: '#080e1d',    // agent monitor / prompt body
          panel: '#0f172a',      // floating monitor shell
          border: '#1e2d45',     // dark-surface borders
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      // Micro ramp for the app's dense labels/eyebrows — replaces ad-hoc text-[10px]/[11px].
      //
      // Declared in px, NOT rem, and that is deliberate: `html` is pinned to font-size:15px,
      // so a rem here resolves against 15 rather than Tailwind's assumed 16. `0.625rem` is
      // 10px only at a 16px root; here it silently rendered 9.375px. These four values are
      // the ones every raw text-[10px]/min-h-[44px] in the app is being folded into, so they
      // have to mean exactly what they say. Browser zoom scales px and rem identically, and
      // the pinned root already prevents rem from tracking the user's font-size preference,
      // so nothing is lost by being literal.
      fontSize: {
        micro: ['10px', { lineHeight: '14px' }],
        '2xs': ['11px', { lineHeight: '16px' }],
      },
      // Two canonical control heights: compact (toolbars) and touch (forms/CTAs, ≥44px = HIG).
      minHeight: {
        control: '36px',
        'control-lg': '44px', // the HIG minimum — must not be a rem, see above
      },
    },
  },
  plugins: [],
};
