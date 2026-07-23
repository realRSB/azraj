import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api.js";
import imessageLogo from "./assets/imessage-logo.png";

declare global {
  interface Window {
    VANTA?: {
      CLOUDS?: (config: Record<string, unknown>) => { destroy: () => void };
    };
  }
}

const AZRAJ_NUMBER = import.meta.env.VITE_AZRAJ_PHONE_NUMBER || "+17862139361";
const SESSION_KEY = "azraj.publicSessionToken";

type Page = "home" | "dashboard";
type ConnectStep = "phone" | "code" | "connected";

type PublicDashboard = {
  user: {
    phoneE164: string;
    displayName?: string;
    onboardingStatus: "started" | "connected";
  };
  conversationIds: string[];
  metrics: {
    messages: number;
    memories: {
      total: number;
      shortTerm: number;
      longTerm: number;
      permanent: number;
    };
    agents: {
      total: number;
      running: number;
      completed: number;
      failed: number;
    };
    automations: {
      total: number;
      enabled: number;
    };
    usage: {
      totalCost: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    dailyBuckets: Array<{
      day: string;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      messages: number;
    }>;
  };
  recentMessages: Array<{
    _id: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: number;
  }>;
  memories: Array<{
    _id: string;
    memoryId: string;
    content: string;
    tier: "short" | "long" | "permanent";
    segment: string;
    importance: number;
    createdAt: number;
  }>;
  automations: Array<{
    _id: string;
    name: string;
    schedule: string;
    timezone?: string;
    enabled: boolean;
    nextRunAt?: number;
  }>;
};

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

function getStoredSession() {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function setStoredSession(token: string | null) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage can be disabled */
  }
}

function formatCurrency(value: number) {
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

function formatNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `••• ${digits.slice(-4)}`;
}

export function App() {
  const [page, setPage] = useState<Page>(() =>
    window.location.pathname === "/dashboard" ? "dashboard" : "home",
  );
  const [sessionToken, setSessionToken] = useState<string | null>(getStoredSession);
  const [splashVisible, setSplashVisible] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectStep, setConnectStep] = useState<ConnectStep>(sessionToken ? "connected" : "phone");
  const [phone, setPhone] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [copied, setCopied] = useState<"number" | "message" | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [cursor, setCursor] = useState({ x: -100, y: -100, active: false });

  const dashboard = useQuery(
    api.publicUsers.dashboard,
    sessionToken ? { sessionToken } : "skip",
  ) as PublicDashboard | null | undefined;

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
  }, [page]);

  useEffect(() => {
    const updateCursor = (event: MouseEvent) => {
      const target = event.target;
      const active = target instanceof Element && Boolean(target.closest("a, button, input"));
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

  useEffect(() => {
    setStoredSession(sessionToken);
    if (sessionToken) setConnectStep("connected");
  }, [sessionToken]);

  function navigate(nextPage: Page) {
    setPage(nextPage);
    window.history.pushState(null, "", nextPage === "dashboard" ? "/dashboard" : "/");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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

  async function startAuth(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    setDevCode(null);
    try {
      const res = await fetch("/api/public-auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "couldn't send code");
      setVerifiedPhone(data.phoneE164);
      setDevCode(data.devCode ?? null);
      setConnectStep("code");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function verifyAuth(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/public-auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: verifiedPhone || phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "code didn't work");
      setSessionToken(data.sessionToken);
      setConnectStep("connected");
      setCode("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  }

  function signOut() {
    setSessionToken(null);
    setConnectStep("phone");
    setVerifiedPhone("");
    setPhone("");
    if (page === "dashboard") navigate("home");
  }

  return (
    <main className="azraj-page">
      <div id="azraj-clouds" className="clouds" aria-hidden="true" />

      <CustomCursor active={cursor.active} style={cursorStyle} />

      {splashVisible && <Splash />}

      <header className="site-nav" aria-label="Azraj navigation">
        <nav className="nav-links" aria-label="Page sections">
          <button type="button" onClick={() => navigate("home")}>
            home
          </button>
          <a href={page === "home" ? "#how" : "/#how"}>how it works</a>
        </nav>
        <button className="nav-brand" type="button" onClick={() => navigate("home")} aria-label="Azraj home">
          azraj
        </button>
        <div className="nav-auth" aria-label="Account actions">
          {sessionToken ? (
            <>
              <button type="button" onClick={() => navigate("dashboard")}>
                dashboard
              </button>
              <button type="button" className="nav-auth-primary" onClick={signOut}>
                sign out
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setConnectOpen(true)}>
                sign in
              </button>
              <button type="button" className="nav-auth-primary" onClick={() => setConnectOpen(true)}>
                sign up
              </button>
            </>
          )}
        </div>
      </header>

      {page === "dashboard" ? (
        <UserDashboard
          dashboard={dashboard}
          sessionToken={sessionToken}
          onConnect={() => setConnectOpen(true)}
        />
      ) : (
        <>
          <LandingHero onConnect={() => setConnectOpen(true)} />
          <StorySection currentStory={currentStory} activeStep={activeStep} />
        </>
      )}

      {connectOpen && (
        <ConnectModal
          step={connectStep}
          phone={phone}
          verifiedPhone={verifiedPhone}
          code={code}
          devCode={devCode}
          busy={authBusy}
          error={authError}
          copied={copied}
          starterMessage={starterMessage}
          smsHref={smsHref}
          onClose={() => setConnectOpen(false)}
          onPhoneChange={setPhone}
          onCodeChange={setCode}
          onStart={startAuth}
          onVerify={verifyAuth}
          onCopy={copyText}
          onDashboard={() => {
            setConnectOpen(false);
            navigate("dashboard");
          }}
        />
      )}
    </main>
  );
}

function Splash() {
  return (
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
  );
}

function LandingHero({ onConnect }: { onConnect: () => void }) {
  return (
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
        <button className="start-button" type="button" onClick={onConnect}>
          <img className="imessage-logo" src={imessageLogo} alt="" aria-hidden="true" />
          Start Connecting
        </button>
        <p>verify your phone. text azraj. watch your dashboard fill up.</p>
      </div>
    </section>
  );
}

function ConnectModal({
  step,
  phone,
  verifiedPhone,
  code,
  devCode,
  busy,
  error,
  copied,
  starterMessage,
  smsHref,
  onClose,
  onPhoneChange,
  onCodeChange,
  onStart,
  onVerify,
  onCopy,
  onDashboard,
}: {
  step: ConnectStep;
  phone: string;
  verifiedPhone: string;
  code: string;
  devCode: string | null;
  busy: boolean;
  error: string | null;
  copied: "number" | "message" | null;
  starterMessage: string;
  smsHref: string;
  onClose: () => void;
  onPhoneChange: (phone: string) => void;
  onCodeChange: (code: string) => void;
  onStart: (event: FormEvent) => void;
  onVerify: (event: FormEvent) => void;
  onCopy: (kind: "number" | "message", value: string) => void;
  onDashboard: () => void;
}) {
  return (
    <section className="connect-overlay" aria-label="Start connecting with Azraj">
      <button
        className="connect-scrim"
        type="button"
        aria-label="Close connection card"
        onClick={onClose}
      />
      <div className="connect-card" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <button className="connect-close" type="button" aria-label="Close" onClick={onClose}>
          x
        </button>
        <p className="connect-brand">azraj</p>
        <h2 id="connect-title">
          {step === "connected" ? "you’re connected" : "Welcome to Azraj"}
        </h2>
        <p className="connect-copy">
          {step === "phone" &&
            "verify your number first so azraj can connect your texts to your dashboard."}
          {step === "code" &&
            `enter the 6-digit code sent to ${maskPhone(verifiedPhone || phone)}.`}
          {step === "connected" &&
            "send this message to start your accountability thread, then open your dashboard anytime."}
        </p>

        {step === "phone" && (
          <form className="connect-form" onSubmit={onStart}>
            <label>
              <span>phone number</span>
              <input
                value={phone}
                onChange={(event) => onPhoneChange(event.target.value)}
                placeholder="+1 786 213 9361"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
            <button className="connect-submit" type="submit" disabled={busy}>
              {busy ? "sending code..." : "send code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form className="connect-form" onSubmit={onVerify}>
            <label>
              <span>verification code</span>
              <input
                value={code}
                onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            {devCode && <p className="connect-dev-code">dev code: {devCode}</p>}
            <button className="connect-submit" type="submit" disabled={busy}>
              {busy ? "checking..." : "verify and connect"}
            </button>
          </form>
        )}

        {step === "connected" && (
          <>
            <button
              className="connect-field"
              type="button"
              onClick={() => onCopy("number", AZRAJ_NUMBER)}
            >
              <span>Your Azraj number</span>
              <strong>{AZRAJ_NUMBER}</strong>
              <small>{copied === "number" ? "copied" : "tap to copy"}</small>
            </button>

            <button
              className="connect-field connect-message"
              type="button"
              onClick={() => onCopy("message", starterMessage)}
            >
              <strong>{starterMessage}</strong>
              <small>{copied === "message" ? "copied" : "tap to copy message"}</small>
            </button>

            <a className="connect-open" href={smsHref}>
              <img className="imessage-logo" src={imessageLogo} alt="" aria-hidden="true" />
              Open iMessage
            </a>

            <button className="connect-dashboard" type="button" onClick={onDashboard}>
              open dashboard
            </button>
          </>
        )}

        {error && <p className="connect-error">{error}</p>}
        <p className="connect-help">
          Didn&apos;t open? Copy the message, then send it to the Azraj number above.
        </p>
      </div>
    </section>
  );
}

function UserDashboard({
  dashboard,
  sessionToken,
  onConnect,
}: {
  dashboard: PublicDashboard | null | undefined;
  sessionToken: string | null;
  onConnect: () => void;
}) {
  if (!sessionToken) {
    return (
      <section className="public-dashboard empty-dashboard">
        <div className="dashboard-empty-card">
          <p>dashboard</p>
          <h1>verify your number first</h1>
          <span>azraj needs your phone login before it can show texts, memory, and costs.</span>
          <button type="button" className="start-button" onClick={onConnect}>
            <img className="imessage-logo" src={imessageLogo} alt="" aria-hidden="true" />
            Start Connecting
          </button>
        </div>
      </section>
    );
  }

  if (dashboard === undefined) {
    return (
      <section className="public-dashboard empty-dashboard">
        <div className="dashboard-empty-card">
          <p>dashboard</p>
          <h1>loading your accountability data</h1>
          <span>pulling messages, memory, automations, and usage from convex.</span>
        </div>
      </section>
    );
  }

  if (dashboard === null) {
    return (
      <section className="public-dashboard empty-dashboard">
        <div className="dashboard-empty-card">
          <p>session expired</p>
          <h1>sign in again</h1>
          <span>your dashboard session expired, but your Azraj data is still there.</span>
          <button type="button" className="start-button" onClick={onConnect}>
            <img className="imessage-logo" src={imessageLogo} alt="" aria-hidden="true" />
            sign in
          </button>
        </div>
      </section>
    );
  }

  const newestMessage = dashboard.recentMessages[0];
  const dailyMax = Math.max(...dashboard.metrics.dailyBuckets.map((bucket) => bucket.costUsd), 0.01);

  return (
    <section className="public-dashboard">
      <div className="dashboard-hero">
        <div>
          <p className="eyebrow">your azraj dashboard</p>
          <h1>accountability, receipts included.</h1>
          <span>
            signed in as {maskPhone(dashboard.user.phoneE164)}. every card here is scoped
            to your verified iMessage thread.
          </span>
        </div>
        <a className="connect-open dashboard-imessage" href={`sms:${smsNumber(AZRAJ_NUMBER)}`}>
          <img className="imessage-logo" src={imessageLogo} alt="" aria-hidden="true" />
          text azraj
        </a>
      </div>

      <div className="dashboard-grid">
        <MetricCard label="messages" value={formatNumber(dashboard.metrics.messages)} detail="conversation rows" />
        <MetricCard
          label="memory"
          value={formatNumber(dashboard.metrics.memories.total)}
          detail={`${dashboard.metrics.memories.shortTerm} short / ${dashboard.metrics.memories.longTerm} long / ${dashboard.metrics.memories.permanent} perm`}
        />
        <MetricCard
          label="usage"
          value={formatCurrency(dashboard.metrics.usage.totalCost)}
          detail={`${formatNumber(dashboard.metrics.usage.totalTokens)} tokens`}
        />
        <MetricCard
          label="check-ins"
          value={formatNumber(dashboard.metrics.automations.enabled)}
          detail={`${dashboard.metrics.automations.total} scheduled`}
        />
      </div>

      <div className="dashboard-main">
        <section className="dashboard-panel usage-panel">
          <div className="dashboard-panel-head">
            <div>
              <p>usage trend</p>
              <h2>daily cost</h2>
            </div>
            <span>{formatCurrency(dashboard.metrics.usage.totalCost)} total</span>
          </div>
          <div className="usage-bars" aria-label="Daily usage cost">
            {dashboard.metrics.dailyBuckets.length > 0 ? (
              dashboard.metrics.dailyBuckets.slice(-14).map((bucket) => (
                <div key={bucket.day} className="usage-bar">
                  <span style={{ height: `${Math.max(8, (bucket.costUsd / dailyMax) * 100)}%` }} />
                  <small>{bucket.day.slice(5)}</small>
                </div>
              ))
            ) : (
              <div className="dashboard-empty-line">usage appears after azraj answers texts.</div>
            )}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <p>latest thread</p>
              <h2>messages</h2>
            </div>
            <span>{newestMessage ? new Date(newestMessage.createdAt).toLocaleDateString() : "none yet"}</span>
          </div>
          <div className="dashboard-thread">
            {dashboard.recentMessages.length > 0 ? (
              dashboard.recentMessages.slice(0, 8).map((message) => (
                <article key={message._id} data-role={message.role}>
                  <span>{message.role}</span>
                  <p>{message.content}</p>
                </article>
              ))
            ) : (
              <div className="dashboard-empty-line">text azraj once and your thread shows here.</div>
            )}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <p>store</p>
              <h2>memory</h2>
            </div>
            <span>{dashboard.memories.length} shown</span>
          </div>
          <div className="memory-list">
            {dashboard.memories.length > 0 ? (
              dashboard.memories.slice(0, 8).map((memory) => (
                <article key={memory._id}>
                  <div>
                    <span>{memory.tier}</span>
                    <span>{memory.segment}</span>
                  </div>
                  <p>{memory.content}</p>
                </article>
              ))
            ) : (
              <div className="dashboard-empty-line">
                new memories from your verified conversation will show here.
              </div>
            )}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <p>rhythm</p>
              <h2>check-ins</h2>
            </div>
            <span>{dashboard.metrics.automations.enabled} active</span>
          </div>
          <div className="automation-list">
            {dashboard.automations.length > 0 ? (
              dashboard.automations.map((automation) => (
                <article key={automation._id}>
                  <div>
                    <strong>{automation.name}</strong>
                    <span>{automation.enabled ? "active" : "paused"}</span>
                  </div>
                  <p>{automation.schedule}{automation.timezone ? ` · ${automation.timezone}` : ""}</p>
                </article>
              ))
            ) : (
              <div className="dashboard-empty-line">
                ask azraj to check in daily, tonight, or every week.
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function StorySection({
  currentStory,
  activeStep,
}: {
  currentStory: (typeof storySteps)[number];
  activeStep: number;
}) {
  return (
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
