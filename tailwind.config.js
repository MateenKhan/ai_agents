/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Piranha brand accent (red #FF3B1D). `accent-*` is the brand ramp used across the app;
        // `brand-*` is an alias of it. A future re-theme is one edit here. Semantic status/error
        // colors (rose for errors, the board lane hues) stay separate and are NOT this red.
        accent: {
          50: '#fff1ee', 100: '#ffe0d9', 200: '#ffc2b3', 300: '#ff9a83', 400: '#ff6a4d',
          500: '#ff3b1d', 600: '#e62e12', 700: '#bf2410', 800: '#991f13', 900: '#7e1d15', 950: '#450a05',
        },
        brand: {
          50: '#fff1ee', 100: '#ffe0d9', 200: '#ffc2b3', 300: '#ff9a83', 400: '#ff6a4d',
          500: '#ff3b1d', 600: '#e62e12', 700: '#bf2410', 800: '#991f13', 900: '#7e1d15', 950: '#450a05',
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
      fontSize: {
        micro: ['0.625rem', { lineHeight: '0.875rem' }], // 10px
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],     // 11px
      },
      // Two canonical control heights: compact (toolbars) and touch (forms/CTAs, ≥44px = HIG).
      minHeight: {
        control: '2.25rem',      // 36px
        'control-lg': '2.75rem', // 44px
      },
    },
  },
  plugins: [],
};
