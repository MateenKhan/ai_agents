---
name: ui-ux-pro-max
description: World-class UI/UX design skill inspired by shadcn/ui and ui-ux-pro-max for creating stunning, polished, accessible, and highly responsive modern web components.
---

# UI/UX Pro Max Design Standard

When building or modifying UI components in Piranha (`/canvas`, `/designer`, `/ide`, or main pages), adhere strictly to these world-class design standards:

## 1. Visual Aesthetics & Polish
* **Curated Color Palettes:** Never use pure harsh primaries (`#FF0000`). Use rich slate/zinc dark themes (`bg-[#0f172a]`, `bg-[#1e1e1e]`, `border-slate-700/60`) paired with vibrant accent tokens (`emerald-500`, `indigo-500`, `amber-500`).
* **Glassmorphism & Depth:** Layer UI elements using subtle surface elevation (`backdrop-blur-md`, `bg-slate-900/80`, layered border opacities).
* **Typography Hierarchy:** Use crisp sans-serif scales with tight letter spacing for headers (`font-bold tracking-tight text-slate-100`) and readable neutral tones for secondary copy (`text-slate-400 text-xs`).

## 2. Dynamic Micro-Interactions & State
* **Interactive Feedback:** Every clickable element must have distinct hover (`hover:bg-slate-800 transition-colors duration-150`), active (`active:scale-[0.98]`), and disabled states (`disabled:opacity-40 disabled:cursor-not-allowed`).
* **Loading & Empty States:** Never show blank screens. Use smooth skeleton shimmers or descriptive empty state illustrations/icons (`lucide-react`) when waiting for data.

## 3. Accessibility & Layout Excellence
* **Focus Visibility:** Ensure clean, high-contrast keyboard navigation focus rings (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`).
* **Responsive Viewports:** Ensure panels flex gracefully across screen sizes (`min-w-0`, `truncate`, custom styled scrollbars).
