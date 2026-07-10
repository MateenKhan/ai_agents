import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icons, REPO, INSTALL_CMD, LEAD, REST, MICRO, USE_CASES, COMPARE, COMPARE_NOTE, STEPS, NEXT, LANES, type Card, type Cell } from './content';

/**
 * The Piranha landing page — the single source for both `/features` in the app and the
 * static docs/index.html that GitHub Pages serves (see scripts/build-landing.tsx, which
 * renders THIS component with renderToStaticMarkup).
 *
 * That is why nothing here reads `window` outside an effect: the component must render on
 * the server. Two consequences shape the code below.
 *
 *  - The typewriter's initial state is the FULL headline, not an empty string. Prerendered
 *    HTML and no-JS readers therefore get a real h1, and the animation is an enhancement
 *    that erases and retypes it before first paint. Reversing that (start empty, fill in)
 *    would ship a blank headline to crawlers.
 *
 *  - Scroll reveal is applied by the client only. The static build injects a <noscript>
 *    override, so a reader without JS never faces a page of invisible sections.
 */

// useLayoutEffect warns during server render; the typewriter's pre-paint reset genuinely
// needs the layout phase on the client, so pick per environment rather than suppress.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const HEAD = 'Throw a task in. ';
const ACCENT = 'Watch the swarm.';

/** Types `head` then `accent`. Starts fully rendered — see the note above. */
function useTypewriter(head: string, accent: string) {
  const [typed, setTyped] = useState({ head, accent, done: true });

  useIsomorphicLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    setTyped({ head: '', accent: '', done: false });

    let i = 0, j = 0, timer = 0;
    const step = () => {
      if (i < head.length) { i++; setTyped({ head: head.slice(0, i), accent: '', done: false }); timer = window.setTimeout(step, 40); }
      else if (j < accent.length) { j++; setTyped({ head, accent: accent.slice(0, j), done: false }); timer = window.setTimeout(step, 52); }
      else setTyped({ head, accent, done: true });
    };
    timer = window.setTimeout(step, 40);
    return () => window.clearTimeout(timer);
  }, [head, accent]);

  return typed;
}

/** Adds `.in` to every `.reveal` inside `root` as it scrolls into view. No-op without IO. */
function useReveal(root: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const targets = Array.from(el.querySelectorAll<HTMLElement>('.reveal'));
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      targets.forEach(t => t.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }),
      { rootMargin: '0px 0px -8% 0px' },
    );
    targets.forEach((t, i) => { t.style.transitionDelay = `${Math.min(i % 4, 3) * 55}ms`; io.observe(t); });
    return () => io.disconnect();
  }, [root]);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      // Non-secure contexts (plain http on a VPS) have no clipboard API.
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* give up quietly */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button className={`copybtn${copied ? ' ok' : ''}`} onClick={copy} aria-label="Copy install command">
      {copied ? Icons.check : Icons.copy}
    </button>
  );
}

const Mark = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <rect width="100" height="100" rx="22" fill="#0A0E14" />
    <g fill="#FF3B1D">
      <path d="M18 28 L28 54 L38 28 Z" /><path d="M36 28 L46 54 L56 28 Z" /><path d="M54 28 L64 54 L74 28 Z" />
      <path d="M27 74 L37 48 L47 74 Z" /><path d="M45 74 L55 48 L65 74 Z" /><path d="M63 74 L73 48 L83 74 Z" />
    </g>
  </svg>
);

const FeatureCard = ({ c, lead }: { c: Card; lead?: boolean }) => (
  <div className={`card${lead ? ' lead' : ''} reveal`}>
    {c.tag && <span className="tag">{c.tag}</span>}
    <div className="ic">{c.icon}</div>
    <h3>{c.title}</h3>
    <p className="mech">{c.body}</p>
    {c.shot && <div className="shot">screenshot slot<br />{c.shot}</div>}
  </div>
);

const SecHead = ({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) => (
  <div className="sec-head reveal">
    <span className="kicker">{eyebrow}</span>
    <h2>{title}</h2>
    {children && <p>{children}</p>}
  </div>
);

/**
 * A blank (`—`) and a miss (`✗`) must not look the same. The blank says "we didn't verify
 * this"; the cross says "this does not exist, including in our own column". Collapsing them
 * would turn every competitor gap into an accusation and every gap of ours into a shrug.
 *
 * `role="img"` is load-bearing: aria-label on a bare <span> names nothing, because a generic
 * role takes no accessible name. Without it a screen reader announces the glyph, or silence.
 */
const glyph = (cls: string, ch: string, label: string) =>
  <span className={cls} role="img" aria-label={label}>{ch}</span>;

const cell = (v: Cell) =>
  v === true ? glyph('yes', '✓', 'Yes')
    : v === false ? glyph('miss', '✗', 'No')
      : v === null ? glyph('no', '—', 'Not a core focus, or unverified')
        : v === 'planned' ? <span className="soon">planned</span>
          : <span className="partial">{v}</span>;

/**
 * `inApp` is false when scripts/build-landing.tsx prerenders this for GitHub Pages, and true
 * for the /features route. It gates the only difference between the two renders: a link back
 * to the board. On the marketing site that link would 404 — there is no board there — so the
 * page must not simply assume it is always running inside the app.
 */
export default function FeaturesPage({ inApp = false }: { inApp?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { head, accent, done } = useTypewriter(HEAD, ACCENT);
  useReveal(rootRef);

  // Smooth anchor scrolling and text-size-adjust belong on <html>, not on our subtree.
  // Scoped to this route's lifetime so leaving it leaves the app's document untouched.
  useEffect(() => {
    document.documentElement.classList.add('pf-root');
    const prev = document.title;
    document.title = 'Piranha — throw a task in, watch the swarm';
    return () => { document.documentElement.classList.remove('pf-root'); document.title = prev; };
  }, []);

  return (
    <div className="pf" ref={rootRef}>
      <header>
        <div className="rail nav">
          <span className="brand"><Mark />Piranha</span>
          <span className="spacer" />
          <a className="lnk" href="#features">Features</a>
          <a className="lnk" href="#compare">Compare</a>
          <a className="lnk" href="#next">Next</a>
          <a className="lnk" href="#install">Install</a>
          {inApp && <Link className="btn btn-cta btn-tiny" to="/tasks">{Icons.board} Open the board</Link>}
          <a className="btn btn-quiet btn-tiny" href={REPO} aria-label="Star Piranha on GitHub">{Icons.github} Star</a>
        </div>
      </header>

      <main>
        <div className="rail hero">
          <div>
            <div className="pills">
              <span className="pill free"><span className="d" />Free &amp; open source · MIT</span>
              <span className="pill plan"><span className="d" />Runs on your Claude subscription</span>
            </div>
            <h1>
              <span>{head}</span><span className="swarm">{accent}</span>
              {!done && <span className="caret" aria-hidden="true" />}
            </h1>
            <p className="sub">
              A swarm of AI agents that chews through your backlog — each works in its own sandbox,
              learns as it goes, and <b>nothing ships without your click.</b> Built for shipping code;
              ready for <b>any task an AI can do.</b>
            </p>
            <div className="cta-row">
              <a className="btn btn-cta" href={REPO}>{Icons.star} Star on GitHub</a>
              <a className="btn btn-quiet" href="#install">Deploy hosted <span aria-hidden="true">→</span></a>
            </div>
            <p className="cta-note">$0 to run. Self-host on your machine or a $5 VPS — code stays local, secrets encrypted at rest.</p>

            <div className="copyline">
              <div className="lbl">One-line install</div>
              <div className="code">
                <code><b>ANTHROPIC_API_KEY=</b>sk-... docker compose up</code>
                <CopyButton text={INSTALL_CMD} />
              </div>
            </div>
          </div>

          <div className="demo reveal" aria-label="Product preview: the agent board">
            <div className="bar"><i /><i /><i /><span className="t">piranha · board</span></div>
            <div className="board">
              {LANES.map(l => (
                <div key={l.cls} className={`lane ${l.cls}`}>
                  <span className="h">{l.label}</span>
                  <div className="chip">
                    <b>{l.title}</b>{l.meta}
                    {'prog' in l && l.prog && <div className="prog"><i style={{ width: l.prog }} /></div>}
                  </div>
                  {'gate' in l && l.gate && <div className="gate">▲ Approve &amp; merge</div>}
                </div>
              ))}
            </div>
            <span className="cap">demo GIF here → docs/assets/demo.gif</span>
          </div>
        </div>

        <div className="rail usecases reveal">
          <span className="uc-eyebrow">Not just code — any task an AI can do</span>
          <div className="uc-row">{USE_CASES.map(u => <span className="uc" key={u}>{u}</span>)}</div>
          <p className="uc-note">
            Coding is the flagship — but the engine is generic. Describe any repeatable job; the swarm
            plans it, does the work, and waits for your approval before anything goes live.
          </p>
        </div>

        <section id="features">
          <div className="rail">
            <SecHead eyebrow="The bite" title="Four things nobody else pairs.">
              The differentiators up top — the rest of a real dev team, automated, below them.
            </SecHead>
            <div className="grid-lead">{LEAD.map(c => <FeatureCard key={c.title} c={c} lead />)}</div>
            <div className="grid-rest">{REST.map(c => <FeatureCard key={c.title} c={c} />)}</div>
            <div className="micro reveal">{MICRO.map(m => <span key={m}>{m}</span>)}</div>
          </div>
        </section>

        <section id="compare">
          <div className="rail">
            <SecHead eyebrow="Honest comparison" title="How the swarm stacks up.">
              The last two rows are ours to lose. We’d rather show them than have you find them.
            </SecHead>
            <div className="tablewrap reveal">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Capability</th>
                    <th scope="col" className="us">Piranha</th>
                    <th scope="col">Devin</th>
                    <th scope="col">Cursor agents</th>
                    <th scope="col">OpenHands</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map(r => (
                    <tr key={r.feature}>
                      <td className="feat">{r.feature}</td>
                      <td className="us">{cell(r.piranha)}</td>
                      <td>{cell(r.devin)}</td>
                      <td>{cell(r.cursor)}</td>
                      <td>{cell(r.openhands)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tablenote reveal">
              {COMPARE_NOTE} <a href={`${REPO}/issues/new`}>Open an issue</a> — we’ll fix it.
            </p>
          </div>
        </section>

        <section id="how">
          <div className="rail">
            <SecHead eyebrow="How it works" title="Task in, merge out — in four moves." />
            <div className="how">
              {STEPS.map((s, i) => (
                <div className="stepcard reveal" key={s.n}>
                  <span className="n">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  {i < STEPS.length - 1 && Icons.arrow}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="next">
          <div className="rail">
            <SecHead eyebrow="Shipping next" title="On the slab.">
              Written down before it’s done — so you always know what’s real and what isn’t.
            </SecHead>
            <div className="grid-rest">{NEXT.map(c => <FeatureCard key={c.title} c={c} />)}</div>
          </div>
        </section>

        <section id="install">
          <div className="rail">
            <SecHead eyebrow="Get running" title="Free to run. Two minutes to your first agent.">
              Uses Claude Code under the hood — authenticate with <b>your Claude Pro/Max subscription</b> or
              an API key. No metered bill required.
            </SecHead>
            <div className="install">
              <div className="codeblock reveal">
                <div className="h">Docker — one command</div>
                <pre>
                  <span className="cmt"># board + swarm + local index</span>{'\n'}
                  ANTHROPIC_API_KEY=sk-... docker compose up{'\n\n'}
                  <span className="cmt"># open the board</span>{'\n'}
                  <span className="k">open</span> http://localhost:6951
                </pre>
              </div>
              <div className="codeblock reveal">
                <div className="h">From source</div>
                <pre>
                  git clone https://github.com/MateenKhan/piranha{'\n'}
                  <span className="k">cd</span> piranha &amp;&amp; pnpm install{'\n\n'}
                  <span className="cmt"># sign in with your Claude plan, or set a key</span>{'\n'}
                  npm run agents
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="rail foot">
          <span className="brand"><Mark size={22} />Piranha</span>
          <span className="lic">MIT License · © 2026 Piranha contributors</span>
          <span>
            {inApp && <><Link to="/tasks">Back to the board</Link> &nbsp;·&nbsp;</>}
            <a href={`${REPO}/blob/main/ROADMAP.md`}>Roadmap</a> &nbsp;·&nbsp;
            <a href={REPO}>GitHub</a> &nbsp;·&nbsp;
            <a href="#install">Deploy</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
