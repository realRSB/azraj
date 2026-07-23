import { useEffect, useMemo, useState, type CSSProperties } from "react";
import imessageLogo from "./assets/imessage-logo.png";

declare global {
  interface Window {
    VANTA?: {
      CLOUDS?: (config: Record<string, unknown>) => { destroy: () => void };
    };
  }
}

const AZRAJ_NUMBER = import.meta.env.VITE_AZRAJ_PHONE_NUMBER || "+17862139361";

const storySteps = [
  {
    label: "morning",
    title: "plan the day before the day plans you",
    body: "send azraj the messy version of your goals. it turns them into a short list you can actually finish.",
  },
  {
    label: "midday",
    title: "prove you started",
    body: "azraj checks in when motivation usually dips. not a lecture, just the next move and a little pressure.",
  },
  {
    label: "night",
    title: "own the scoreboard",
    body: "finish with an honest review: what got done, what slipped, and what changes tomorrow.",
  },
  {
    label: "weekly",
    title: "build a bigger mindset",
    body: "each week, azraj gives you a mindset, person to study, and readings to bring back into the conversation.",
  },
];

function smsNumber(number: string) {
  return number.replace(/[^\d+]/g, "");
}

export function App() {
  const [splashVisible, setSplashVisible] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [copied, setCopied] = useState<"number" | "message" | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [cursor, setCursor] = useState({ x: -100, y: -100, active: false });

  useEffect(() => {
    let effect: { destroy: () => void } | undefined;
    let cancelled = false;
    let attempts = 0;

    const bootVanta = () => {
      if (cancelled) return;

      if (!window.VANTA?.CLOUDS) {
        attempts += 1;
        if (attempts < 80) {
          window.setTimeout(bootVanta, 100);
        }
        return;
      }

      effect = window.VANTA.CLOUDS({
        el: "#azraj-clouds",
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200.0,
        minWidth: 200.0,
      });
    };

    bootVanta();

    return () => {
      cancelled = true;
      effect?.destroy();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplashVisible(false), 2800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".story-step"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const index = Number(visible?.target.getAttribute("data-step"));
        if (Number.isFinite(index)) setActiveStep(index);
      },
      { rootMargin: "-35% 0px -35% 0px", threshold: [0.12, 0.34, 0.58, 0.82] },
    );

    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateCursor = (event: MouseEvent) => {
      const target = event.target;
      const active = target instanceof Element && Boolean(target.closest("a, button"));
      setCursor({ x: event.clientX, y: event.clientY, active });
    };

    window.addEventListener("mousemove", updateCursor);
    return () => window.removeEventListener("mousemove", updateCursor);
  }, []);

  useEffect(() => {
    if (!connectOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConnectOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [connectOpen]);

  const firstText = encodeURIComponent("yo azraj, help me plan today.");
  const starterMessage = "yo azraj, help me plan today.";
  const smsHref = `sms:${smsNumber(AZRAJ_NUMBER)}?&body=${firstText}`;
  const currentStory = storySteps[activeStep] ?? storySteps[0];
  const cursorStyle = useMemo(
    () => ({ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` }),
    [cursor.x, cursor.y],
  );

  async function copyText(kind: "number" | "message", value: string) {
    await navigator.clipboard?.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  }

  return (
    <main className="azraj-page">
      <div id="azraj-clouds" className="clouds" aria-hidden="true" />

      <CustomCursor active={cursor.active} style={cursorStyle} />

      {splashVisible && (
        <section className="splash" aria-label="Opening Azraj">
          <div className="splash-card">
            <div className="splash-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="splash-topline">
              <p>azraj</p>
              <span>imessage coach</span>
            </div>
            <div className="splash-body">
              <h2>setting up your daily pressure system</h2>
              <div className="splash-thread" aria-hidden="true">
                <div>goals?</div>
                <div>3 wins. one proof pic. night audit.</div>
              </div>
            </div>
            <div className="splash-meta" aria-hidden="true">
              <span>plan</span>
              <span>check in</span>
              <span>review</span>
            </div>
            <div className="splash-progress" aria-hidden="true">
              <div className="splash-ring" />
              <div className="splash-bar">
                <span />
              </div>
            </div>
          </div>
        </section>
      )}

      <header className="site-nav" aria-label="Azraj navigation">
        <nav className="nav-links" aria-label="Page sections">
          <a href="#hero">home</a>
          <a href="#how">how it works</a>
        </nav>
        <a className="nav-brand" href="#hero" aria-label="Azraj home">
          azraj
        </a>
        <div className="nav-auth" aria-label="Mock account actions">
          <button type="button">sign in</button>
          <button type="button" className="nav-auth-primary">
            sign up
          </button>
        </div>
      </header>

      <section id="hero" className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">ai accountability over imessage</p>
          <h1 id="hero-title">your ai accountability coach</h1>
          <p className="subcopy">
            azraj turns daily goals into action, checks your progress, and makes the
            night review impossible to dodge.
          </p>
        </div>

        <figure className="message-stack" aria-label="Azraj message example">
          <div className="message message-in">
            <span>azraj · 8:30a</span>
            gm. what are the 3 wins that make today count?
          </div>
          <div className="message message-out">
            physics set, website polish, apply to 2 internships.
          </div>
          <div className="message message-in">
            bet. start physics first. send proof in 25.
          </div>
        </figure>

        <div className="hero-cta">
          <button className="start-button" type="button" onClick={() => setConnectOpen(true)}>
            <img className="imessage-logo" src={imessageLogo} alt="" aria-hidden="true" />
            Start Connecting
          </button>
          <p>text the number. set the goals. get checked.</p>
        </div>
      </section>

      {connectOpen && (
        <section className="connect-overlay" aria-label="Start connecting with Azraj">
          <button
            className="connect-scrim"
            type="button"
            aria-label="Close connection card"
            onClick={() => setConnectOpen(false)}
          />
          <div className="connect-card" role="dialog" aria-modal="true" aria-labelledby="connect-title">
            <button
              className="connect-close"
              type="button"
              aria-label="Close"
              onClick={() => setConnectOpen(false)}
            >
              x
            </button>
            <p className="connect-brand">azraj</p>
            <h2 id="connect-title">Welcome to Azraj</h2>
            <p className="connect-copy">
              Send this exact message to start your accountability thread, or open
              iMessage and let azraj take it from there.
            </p>

            <button
              className="connect-field"
              type="button"
              onClick={() => copyText("number", AZRAJ_NUMBER)}
            >
              <span>Your Azraj number</span>
              <strong>{AZRAJ_NUMBER}</strong>
              <small>{copied === "number" ? "copied" : "tap to copy"}</small>
            </button>

            <button
              className="connect-field connect-message"
              type="button"
              onClick={() => copyText("message", starterMessage)}
            >
              <strong>{starterMessage}</strong>
              <small>{copied === "message" ? "copied" : "tap to copy message"}</small>
            </button>

            <a className="connect-open" href={smsHref}>
              <img className="imessage-logo" src={imessageLogo} alt="" aria-hidden="true" />
              Open iMessage
            </a>

            <p className="connect-help">
              Didn&apos;t open? Copy the message, then send it to the Azraj number above.
            </p>
          </div>
        </section>
      )}

      <section id="how" className="story" aria-label="What Azraj does">
        <div className="story-sticky">
          <p className="story-kicker">what azraj does</p>
          <div className="story-grid">
            <div className="story-copy">
              <p>{currentStory.label}</p>
              <h2>{currentStory.title}</h2>
              <span>{currentStory.body}</span>
            </div>
            <div className="story-phone" aria-hidden="true">
              <div className="story-phone-head">
                <span />
                <p>azraj</p>
              </div>
              <div className="story-phone-message">{currentStory.body}</div>
            </div>
            <ol className="story-progress">
              {storySteps.map((step, index) => (
                <li key={step.label} data-active={index === activeStep}>
                  <span>{`0${index + 1}`}</span>
                  {step.label}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="story-scroll">
          {storySteps.map((step, index) => (
            <article className="story-step" data-step={index} key={step.label}>
              <span>{step.label}</span>
              <h3>{step.title}</h3>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function CustomCursor({
  active,
  style,
}: {
  active: boolean;
  style: CSSProperties;
}) {
  return (
    <div className="custom-cursor" data-active={active} style={style} aria-hidden="true">
      <span />
    </div>
  );
}
