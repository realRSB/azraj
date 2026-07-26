import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity01Icon,
  AiBrain02Icon,
  ArrowShrink02Icon,
  CheckmarkCircle02Icon,
  DashboardSquare01Icon,
  MachineRobotIcon,
  Settings01Icon,
  WorkflowCircle03Icon,
} from "@hugeicons/core-free-icons";
import {
  DashboardMetricsSurface,
  type DashboardMetrics,
} from "../../../debug/src/components/DashboardPanel.js";
import boopGif from "../../../assets/boop.gif";
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
type DashboardView =
  | "dashboard"
  | "messages"
  | "memory"
  | "automations"
  | "accountability"
  | "settings";
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
      cancelled?: number;
    };
    automations: {
      total: number;
      enabled: number;
      runs?: number;
    };
    accountability: {
      plans: number;
      reviewed: number;
      objectives: number;
      done: number;
      slipped: number;
      activeStatus?: "planned" | "in_progress" | "reviewed" | "missed";
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
      agentsSpawned?: number;
      agentsCompleted?: number;
      agentsFailed?: number;
      agentsCancelled?: number;
      automationRuns?: number;
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
  accountability: {
    activePlan: AccountabilityPlan | null;
    recentPlans: AccountabilityPlan[];
  };
};

type AccountabilityPlan = {
  _id: string;
  localDate: string;
  timezone: string;
  status: "planned" | "in_progress" | "reviewed" | "missed";
  journal?: string;
  energy?: string;
  mood?: string;
  blockers?: string;
  definitionOfDone?: string;
  progressNote?: string;
  completedSummary?: string;
  slippedSummary?: string;
  lesson?: string;
  tomorrowAdjustment?: string;
  updatedAt: number;
  reviewedAt?: number;
  objectives: Array<{
    _id: string;
    text: string;
    status: "pending" | "started" | "done" | "slipped";
    proof?: string;
    notes?: string;
  }>;
};

const EMPTY_ACCOUNTABILITY_METRICS = {
  plans: 0,
  reviewed: 0,
  objectives: 0,
  done: 0,
  slipped: 0,
};

const DASHBOARD_NAV: Array<{ id: DashboardView; label: string; icon: any }> = [
  { id: "dashboard", label: "Dashboard", icon: DashboardSquare01Icon },
  { id: "messages", label: "Messages", icon: Activity01Icon },
  { id: "memory", label: "Memory", icon: AiBrain02Icon },
  { id: "automations", label: "Automations", icon: WorkflowCircle03Icon },
  { id: "accountability", label: "Accountability", icon: CheckmarkCircle02Icon },
  { id: "settings", label: "Settings", icon: Settings01Icon },
];

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

function formatTimestamp(ts?: number) {
  if (!ts) return "not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

function publicDashboardToDebugMetrics(dashboard: PublicDashboard): DashboardMetrics {
  return {
    messages: dashboard.metrics.messages,
    memories: dashboard.metrics.memories,
    agents: {
      total: dashboard.metrics.agents.total,
      running: dashboard.metrics.agents.running,
      completed: dashboard.metrics.agents.completed,
      failed: dashboard.metrics.agents.failed,
      cancelled: dashboard.metrics.agents.cancelled ?? 0,
    },
    cost: {
      total: dashboard.metrics.usage.totalCost,
    },
    tokens: {
      input: dashboard.metrics.usage.inputTokens,
      output: dashboard.metrics.usage.outputTokens,
    },
    dailyBuckets: dashboard.metrics.dailyBuckets.map((bucket) => ({
      day: bucket.day,
      agentCost: bucket.costUsd,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      agentsSpawned: bucket.agentsSpawned ?? 0,
      agentsCompleted: bucket.agentsCompleted ?? 0,
      agentsFailed: bucket.agentsFailed ?? 0,
      agentsCancelled: bucket.agentsCancelled ?? 0,
      automationRuns: bucket.automationRuns ?? 0,
    })),
    truncated: false,
    scanLimit: 5000,
  };
}

function normalizePublicDashboard(dashboard: PublicDashboard): PublicDashboard {
  const metrics = dashboard.metrics ?? ({} as PublicDashboard["metrics"]);
  return {
    ...dashboard,
    conversationIds: dashboard.conversationIds ?? [],
    metrics: {
      messages: metrics.messages ?? 0,
      memories: {
        total: metrics.memories?.total ?? 0,
        shortTerm: metrics.memories?.shortTerm ?? 0,
        longTerm: metrics.memories?.longTerm ?? 0,
        permanent: metrics.memories?.permanent ?? 0,
      },
      agents: {
        total: metrics.agents?.total ?? 0,
        running: metrics.agents?.running ?? 0,
        completed: metrics.agents?.completed ?? 0,
        failed: metrics.agents?.failed ?? 0,
        cancelled: metrics.agents?.cancelled ?? 0,
      },
      automations: {
        total: metrics.automations?.total ?? 0,
        enabled: metrics.automations?.enabled ?? 0,
        runs: metrics.automations?.runs ?? 0,
      },
      accountability: {
        ...EMPTY_ACCOUNTABILITY_METRICS,
        ...(metrics.accountability ?? {}),
      },
      usage: {
        totalCost: metrics.usage?.totalCost ?? 0,
        inputTokens: metrics.usage?.inputTokens ?? 0,
        outputTokens: metrics.usage?.outputTokens ?? 0,
        totalTokens: metrics.usage?.totalTokens ?? 0,
      },
      dailyBuckets: metrics.dailyBuckets ?? [],
    },
    recentMessages: dashboard.recentMessages ?? [],
    memories: dashboard.memories ?? [],
    automations: dashboard.automations ?? [],
    accountability: {
      activePlan: dashboard.accountability?.activePlan ?? null,
      recentPlans: dashboard.accountability?.recentPlans ?? [],
    },
  };
}

async function parseJsonResponse(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("server returned an invalid response");
  }
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
  const [dashboard, setDashboard] = useState<PublicDashboard | null | undefined>(
    sessionToken ? undefined : null,
  );

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

  useEffect(() => {
    if (!sessionToken) {
      setDashboard(null);
      return;
    }

    let cancelled = false;

    async function loadDashboard({ showLoading }: { showLoading: boolean }) {
      if (showLoading) setDashboard(undefined);
      try {
        const res = await fetch("/api/public-auth/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken }),
        });
        const data = await parseJsonResponse(res);
        if (!res.ok) {
          if (!cancelled) setDashboard(null);
          return;
        }
        if (!cancelled) {
          setDashboard(normalizePublicDashboard(data.dashboard as PublicDashboard));
        }
      } catch {
        if (!cancelled) setDashboard(null);
      }
    }

    void loadDashboard({ showLoading: true });
    const timer = window.setInterval(
      () => void loadDashboard({ showLoading: false }),
      5000,
    );

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
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
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(String(data.error ?? "couldn't send code"));
      setVerifiedPhone(String(data.phoneE164 ?? ""));
      setDevCode(typeof data.devCode === "string" ? data.devCode : null);
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
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(String(data.error ?? "code didn't work"));
      setSessionToken(String(data.sessionToken ?? ""));
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
    <main className={`azraj-page ${page === "dashboard" ? "dashboard-page" : ""}`}>
      <div id="azraj-clouds" className="clouds" aria-hidden="true" />

      <CustomCursor active={cursor.active} style={cursorStyle} />

      {splashVisible && <Splash />}

      {page !== "dashboard" && (
        <header className="site-nav" aria-label="Azraj navigation">
          <nav className="nav-links" aria-label="Page sections">
            <button type="button" onClick={() => navigate("home")}>
              home
            </button>
            <a href="#how">how it works</a>
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
      )}

      {page === "dashboard" ? (
        <UserDashboard
          dashboard={dashboard}
          sessionToken={sessionToken}
          onConnect={() => setConnectOpen(true)}
          onSignOut={signOut}
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
  onSignOut,
}: {
  dashboard: PublicDashboard | null | undefined;
  sessionToken: string | null;
  onConnect: () => void;
  onSignOut: () => void;
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

  return (
    <section className="debug-console-host" aria-label="Azraj dashboard">
      <ConsumerDashboardShell dashboard={dashboard} onSignOut={onSignOut} />
    </section>
  );
}

function ConsumerDashboardShell({
  dashboard,
  onSignOut,
}: {
  dashboard: PublicDashboard;
  onSignOut: () => void;
}) {
  const [view, setView] = useState<DashboardView>("dashboard");
  const metrics = useMemo(() => publicDashboardToDebugMetrics(dashboard), [dashboard]);
  const currentView = DASHBOARD_NAV.find((item) => item.id === view)?.label ?? "Dashboard";
  const isDark = true;
  const activePlan = dashboard.accountability.activePlan;

  return (
    <div className="flex h-full bg-[#101012] text-zinc-100">
      <nav className="flex w-[244px] shrink-0 flex-col bg-[#101012] px-3 pb-3 pt-3">
        <div className="flex w-full items-center gap-3 rounded-2xl px-1.5 py-1 text-left">
          <img src={boopGif} alt="Azraj" className="h-8 w-8 rounded-2xl object-cover" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-zinc-100">Azraj</h1>
            <div className="flex items-center gap-1.5 truncate text-xs text-emerald-500">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 pulse-ring" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              connected
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-0.5">
          {DASHBOARD_NAV.map((item) => (
            <button
              key={item.id}
              data-active={view === item.id}
              onClick={() => setView(item.id)}
              className={`sidebar-nav-item flex h-8 w-full items-center gap-2 rounded-2xl px-2.5 text-left text-[12px] ${
                view === item.id ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              <HugeiconsIcon icon={item.icon} size={16} className="shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.id === "accountability" && activePlan && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          ))}
        </div>

        <div className="mt-auto space-y-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-2.5">
            <div className="mb-2 text-xs text-zinc-500">Memory</div>
            <div className="grid grid-cols-3 gap-2">
              <DashboardMetricPill label="Short" value={dashboard.metrics.memories.shortTerm} />
              <DashboardMetricPill label="Long" value={dashboard.metrics.memories.longTerm} />
              <DashboardMetricPill
                label="Perm"
                value={dashboard.metrics.memories.permanent}
                color="text-amber-300"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={() => setView("settings")}
              className="min-w-0 truncate rounded-lg px-1.5 py-1 text-left text-[11px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
            >
              {maskPhone(dashboard.user.phoneE164)}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="shrink-0 rounded-xl px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              sign out
            </button>
          </div>
        </div>
      </nav>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-l-[20px] border-y border-l border-white/10 bg-[#18181b] shadow-sm shadow-black/20">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#18181b] px-5">
          <div>
            <div className="text-[11px] text-zinc-500">Azraj</div>
            <h2 className="text-sm font-medium text-zinc-100">{currentView}</h2>
          </div>
          <button
            type="button"
            onClick={() => setView("settings")}
            className="hidden min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 sm:flex"
            aria-label="Open settings"
          >
            <span className="h-[17px] w-[17px] shrink-0 rounded-md border border-white/10 bg-white/5" />
            <span className="shrink-0 font-medium text-zinc-300">phone</span>
            <span className="max-w-[180px] truncate font-mono font-medium text-zinc-200">
              {maskPhone(dashboard.user.phoneE164)}
            </span>
          </button>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div key={view} className="view-shell debug-scroll h-full overflow-auto p-5">
            {view === "dashboard" && (
              <DashboardMetricsSurface
                data={metrics}
                isDark={isDark}
                eyebrow="Accountability"
                title="Dashboard"
              />
            )}
            {view === "messages" && <MessagesView dashboard={dashboard} />}
            {view === "memory" && <MemoryView dashboard={dashboard} />}
            {view === "automations" && <AutomationsView dashboard={dashboard} />}
            {view === "accountability" && <AccountabilityView dashboard={dashboard} />}
            {view === "settings" && (
              <SettingsView dashboard={dashboard} onSignOut={onSignOut} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function DashboardMetricPill({
  label,
  value,
  color = "text-zinc-300",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="min-w-0 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className={`block truncate font-mono font-semibold ${color}`}>
        {formatNumber(value)}
      </span>
    </div>
  );
}

function ConsumerPanel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div>
        <div className="text-[11px] font-medium uppercase text-zinc-500">{eyebrow}</div>
        <h2 className="mt-1 text-[22px] font-semibold text-zinc-100">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function MessagesView({ dashboard }: { dashboard: PublicDashboard }) {
  return (
    <ConsumerPanel eyebrow="Conversation" title="Messages">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#1d1d20]">
        {dashboard.recentMessages.length > 0 ? (
          <div className="divide-y divide-white/10">
            {dashboard.recentMessages.map((message) => (
              <article key={message._id} className="grid gap-1 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-[11px] uppercase text-zinc-500">
                  <span>{message.role}</span>
                  <span>{formatTimestamp(message.createdAt)}</span>
                </div>
                <p className="max-w-4xl whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                  {message.content}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyConsumerState label="no messages yet. text azraj and this fills in." />
        )}
      </section>
    </ConsumerPanel>
  );
}

function MemoryView({ dashboard }: { dashboard: PublicDashboard }) {
  return (
    <ConsumerPanel eyebrow="Memory" title="What Azraj remembers">
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {dashboard.memories.length > 0 ? (
          dashboard.memories.map((memory) => (
            <article
              key={memory._id}
              className="min-h-[124px] rounded-2xl border border-white/10 bg-[#1d1d20] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase text-zinc-500">
                  {memory.tier}
                </span>
                <span className="font-mono text-[11px] text-zinc-500">
                  {memory.importance.toFixed(2)}
                </span>
              </div>
              <p className="text-sm leading-6 text-zinc-200">{memory.content}</p>
              <div className="mt-3 text-xs text-zinc-500">{memory.segment}</div>
            </article>
          ))
        ) : (
          <EmptyConsumerState label="no memory yet. azraj saves durable goals and patterns as you talk." />
        )}
      </section>
    </ConsumerPanel>
  );
}

function AutomationsView({ dashboard }: { dashboard: PublicDashboard }) {
  return (
    <ConsumerPanel eyebrow="Check-ins" title="Automations">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#1d1d20]">
        {dashboard.automations.length > 0 ? (
          <div className="divide-y divide-white/10">
            {dashboard.automations.map((automation) => (
              <article
                key={automation._id}
                className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        automation.enabled ? "bg-emerald-400" : "bg-zinc-600"
                      }`}
                    />
                    <h3 className="truncate text-sm font-semibold text-zinc-100">
                      {automation.name}
                    </h3>
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-500">{automation.schedule}</p>
                </div>
                <div className="text-left text-xs text-zinc-400 md:text-right">
                  <div>{automation.timezone ?? "local timezone"}</div>
                  <div className="text-zinc-500">next {formatTimestamp(automation.nextRunAt)}</div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyConsumerState label="no check-ins scheduled yet. ask azraj to check in later today." />
        )}
      </section>
    </ConsumerPanel>
  );
}

function AccountabilityView({ dashboard }: { dashboard: PublicDashboard }) {
  const activePlan = dashboard.accountability.activePlan;
  const score =
    dashboard.metrics.accountability.objectives > 0
      ? dashboard.metrics.accountability.done / dashboard.metrics.accountability.objectives
      : 0;

  return (
    <ConsumerPanel eyebrow="Daily system" title="Accountability">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <SmallStat label="plans" value={dashboard.metrics.accountability.plans} />
        <SmallStat label="objectives" value={dashboard.metrics.accountability.objectives} />
        <SmallStat label="done" value={dashboard.metrics.accountability.done} />
        <SmallStat label="score" value={`${(score * 100).toFixed(1)}%`} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#1d1d20]">
        {activePlan ? (
          <div>
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-[11px] uppercase text-zinc-500">{activePlan.localDate}</div>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">
                {activePlan.status.replaceAll("_", " ")}
              </h3>
              {activePlan.journal && (
                <p className="mt-2 text-sm leading-6 text-zinc-300">{activePlan.journal}</p>
              )}
            </div>
            <div className="divide-y divide-white/10">
              {activePlan.objectives.map((objective) => (
                <article key={objective._id} className="flex gap-3 px-4 py-3">
                  <HugeiconsIcon
                    icon={objective.status === "done" ? CheckmarkCircle02Icon : ArrowShrink02Icon}
                    size={18}
                    className={objective.status === "done" ? "text-emerald-400" : "text-zinc-500"}
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-200">{objective.text}</p>
                    <div className="mt-1 text-xs text-zinc-500">{objective.status}</div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <EmptyConsumerState label="no active plan yet. send azraj your goals for today." />
        )}
      </section>
    </ConsumerPanel>
  );
}

function SettingsView({
  dashboard,
  onSignOut,
}: {
  dashboard: PublicDashboard;
  onSignOut: () => void;
}) {
  return (
    <ConsumerPanel eyebrow="Account" title="Settings">
      <section className="rounded-2xl border border-white/10 bg-[#1d1d20] p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <SmallFact label="phone" value={dashboard.user.phoneE164} />
          <SmallFact label="status" value={dashboard.user.onboardingStatus} />
          <SmallFact label="conversations" value={String(dashboard.conversationIds.length)} />
          <SmallFact label="azraj number" value={AZRAJ_NUMBER} />
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
        >
          sign out
        </button>
      </section>
    </ConsumerPanel>
  );
}

function SmallStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#1d1d20] p-4">
      <div className="text-[11px] font-medium uppercase text-zinc-500">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold text-zinc-100">
        {typeof value === "number" ? formatNumber(value) : value}
      </div>
    </div>
  );
}

function SmallFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase text-zinc-500">{label}</div>
      <div className="mt-1 break-words font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

function EmptyConsumerState({ label }: { label: string }) {
  return (
    <div className="grid min-h-[180px] place-items-center px-4 py-8 text-center text-sm text-zinc-500">
      {label}
    </div>
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
