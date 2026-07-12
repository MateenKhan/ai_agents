# Visual React Studio (/designer) Interactive AI Chat & Code Editor Plan

## 1. Problem Statement
- Clicking components or preview elements in `/designer` currently does not provide an immediate code edit option or AI instruction drawer.
- Designers and full-stack developers need to select a UI component and send prompt instructions directly to our AI Chat component (`FileChat`).

## 2. Proposed Solution
- Wire `FileChat.tsx` directly into `VisualDesignerPage.tsx`.
- Add interactive element selection: clicking an element in preview or code mode opens its source file in the embedded editor and primes `FileChat` with context for instant AI modifications.
