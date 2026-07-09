# Piranha — brand kit

**Tagline:** _Throw a task in. Watch the swarm._

## Logo
- [`logo-mark.svg`](./logo-mark.svg) — piranha silhouette (accent red on transparent). Wordmark = mark + "Piranha" in a bold sans (Inter/Geist/Satoshi, weight 800).
- [`favicon.svg`](./favicon.svg) — teeth "bite" on a dark tile. Reads at 16px. Use for browser tab, GitHub, social.

## Colors

| Token | Hex | Use |
| :-- | :-- | :-- |
| `--ink` | `#0A0E14` | Page background (deep water) |
| `--surface` | `#11161F` | Cards, panels |
| `--surface-2` | `#1A2130` | Raised / hover |
| `--accent` | `#FF3B1D` | Piranha red — buttons, links, the mark |
| `--accent-hover` | `#E62E12` | Hover/active |
| `--accent-soft` | `#FF3B1D22` | Tint fills, badges |
| `--text` | `#F5F7FA` | Primary text |
| `--text-muted` | `#8A94A6` | Secondary text |
| `--live` | `#22D3EE` | Cyan — *alive / thinking*. The eye. Agent-active pulse, heartbeat, live status dot |
| `--teal` | `#14B8A6` | Success / "merged" states only |

### Drop-in CSS (reuse in index.html)

```css
:root {
  --ink:#0A0E14; --surface:#11161F; --surface-2:#1A2130;
  --accent:#FF3B1D; --accent-hover:#E62E12; --accent-soft:#FF3B1D22;
  --text:#F5F7FA; --text-muted:#8A94A6; --live:#22D3EE; --teal:#14B8A6;
}
```

## Rules

**Red is the predator. Cyan is the intelligence inside it.** One glowing eye on an angry fish —
raw aggression with a mind behind it. That's the product.

- **One ACTION color: red.** Everything clickable — buttons, links, CTAs, the mark. Nothing else
  competes for a click.
- **Cyan is a STATE color, never an action color.** It means *alive / thinking*: the mascot's eye,
  an agent-active pulse, the heartbeat dot. Never a button. Never a link.
- **Teal is success only** — "merged", "passed". Nothing else.
- Break either rule and the palette starts fighting itself. Semantic, not decorative.
- Dark-first (deep water). A light theme swaps `--ink`/`--surface` for near-white, keeps the red.
- Mono font for code/install lines; bold sans for headings.

## Mascot
Illustrated piranha — deep crimson armor plating, chrome teeth, a glowing cyan eye, and cyan
circuit traces running from the eye through the body.

The traces are **current, not decoration**: the eye is where the intelligence sits, the circuits
are how it reaches the body. That's the same rule as the UI — cyan only ever means *alive*. It
stays on the mascot and on live-state indicators; it never becomes a button.

Keep the 3D shading and depth. Transparent background. Used for the README hero, social preview,
and merch — **not** as the favicon (too detailed at 16px; the flat teeth mark in
[`favicon.svg`](./favicon.svg) does that job).

## Voice
Short, punchy, a little dangerous. "Feed it a repo." "Let the swarm loose." Never corporate.
