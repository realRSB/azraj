import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Link04Icon,
  MachineRobotIcon,
  Settings01Icon,
  WorkflowCircle03Icon,
} from "@hugeicons/core-free-icons";
import {
  DashboardMetricsSurface,
  type DashboardMetrics,
} from "../../../debug/src/components/DashboardPanel.js";
import MemoryGraphView from "../../../debug/src/components/MemoryGraphView.js";
import {
  EmptyState,
  HeaderPill,
  PanelPage,
  mutedTextClass,
  panelCardClass,
  subtlePanelClass,
} from "../../../debug/src/components/PanelPrimitives.js";
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
type ConnectStep = "join" | "signin" | "code" | "connected";
type DashboardView =
  | "dashboard"
  | "messages"
  | "memory"
  | "automations"
  | "connections"
  | "accountability"
  | "settings";
type PublicDashboard = {
  user: {
    phoneE164: string;
    displayName?: string;
    timezone?: string;
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
    accessCount?: number;
    decayRate?: number;
    sourceTurn?: string;
    lastAccessedAt?: number;
    imageStorageIds?: string[];
    metadata?: string;
    supersedes?: string[];
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
  { id: "connections", label: "Connections", icon: Link04Icon },
  { id: "accountability", label: "Accountability", icon: CheckmarkCircle02Icon },
  { id: "settings", label: "Settings", icon: Settings01Icon },
];

type IntegrationAuthMode = "managed" | "byo";

type IntegrationConnection = {
  id: string;
  status: string;
  alias: string | null;
  accountLabel: string | null;
  accountEmail: string | null;
  accountName: string | null;
  accountAvatarUrl: string | null;
  createdAt: string | null;
};

type IntegrationToolkit = {
  slug: string;
  displayName: string;
  authMode: IntegrationAuthMode;
  hasAuthConfig: boolean;
  logoUrl: string | null;
  description: string | null;
  toolCount: number | null;
  connections: IntegrationConnection[];
};

type IntegrationsResponse = {
  enabled: boolean;
  toolkits: IntegrationToolkit[];
};

type IntegrationToolSummary = {
  slug: string;
  name: string;
  description?: string;
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

const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "America/New_York", label: "America/New_York (Eastern)" },
  { value: "America/Chicago", label: "America/Chicago (Central)" },
  { value: "America/Denver", label: "America/Denver (Mountain)" },
  { value: "America/Phoenix", label: "America/Phoenix (Arizona)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (Pacific)" },
  { value: "America/Anchorage", label: "America/Anchorage (Alaska)" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu (Hawaii)" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Europe/Berlin", label: "Europe/Berlin" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
  { value: "UTC", label: "UTC" },
];

type MemoryTierFilter = "all" | "short" | "long" | "permanent";
type MemoryViewMode = "table" | "graph";

const MEMORY_TIER_OPTIONS: Array<{ value: MemoryTierFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "short", label: "Short" },
  { value: "long", label: "Long" },
  { value: "permanent", label: "Permanent" },
];

const MEMORY_SEGMENT_OPTIONS = [
  "all",
  "identity",
  "preference",
  "relationship",
  "project",
  "knowledge",
  "context",
];

const MEMORY_TIER_BADGE: Record<string, string> = {
  short: "text-sky-400 bg-sky-400/10 border-sky-500/20",
  long: "text-violet-400 bg-violet-400/10 border-violet-500/20",
  permanent: "text-amber-400 bg-amber-400/10 border-amber-500/20",
};

const MEMORY_SEGMENT_COLOR: Record<string, string> = {
  identity: "text-rose-400",
  preference: "text-teal-400",
  relationship: "text-pink-400",
  project: "text-orange-400",
  knowledge: "text-blue-400",
  context: "text-slate-400",
};

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
    user: {
      ...(dashboard.user ?? {
        phoneE164: "",
        onboardingStatus: "started" as const,
      }),
      timezone: dashboard.user?.timezone,
    },
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

async function publicAuthPost<T>(
  path: string,
  sessionToken: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`/api/public-auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, ...body }),
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(String(data.error ?? res.statusText));
  }
  return data as T;
}

async function redeemDashboardLink(token: string) {
  const res = await fetch("/api/public-auth/magic/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) throw new Error(String(data.error ?? "dashboard link expired"));
  return data as { sessionToken: string };
}

async function createJoinChallenge() {
  const res = await fetch("/api/public-auth/join/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) throw new Error(String(data.error ?? "couldn't create join code"));
  return data as { code: string; message: string };
}

export function App() {
  const [page, setPage] = useState<Page>(() =>
    window.location.pathname === "/dashboard" ? "dashboard" : "home",
  );
  const [sessionToken, setSessionToken] = useState<string | null>(getStoredSession);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectStep, setConnectStep] = useState<ConnectStep>(sessionToken ? "connected" : "join");
  const [phone, setPhone] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [joinMessageText, setJoinMessageText] = useState("I'm ready to join Azraj [...]!");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNeedsThread, setAuthNeedsThread] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [copied, setCopied] = useState<"number" | "message" | null>(null);
  const [activeStep, setActiveStep] = useState(0);
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
    if (!connectOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConnectOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [connectOpen]);

  useEffect(() => {
    if (!connectOpen || connectStep !== "join" || sessionToken) return;

    let cancelled = false;
    setAuthBusy(true);
    setAuthError(null);
    createJoinChallenge()
      .then((result) => {
        if (!cancelled) setJoinMessageText(result.message);
      })
      .catch((err) => {
        if (!cancelled) {
          setJoinMessageText("I'm ready to join Azraj [...]!");
          setAuthError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setAuthBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectOpen, connectStep, sessionToken]);

  useEffect(() => {
    setStoredSession(sessionToken);
    if (sessionToken) setConnectStep("connected");
  }, [sessionToken]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const magicToken = url.searchParams.get("login");
    if (!magicToken) return;

    let cancelled = false;
    setPage("dashboard");
    setDashboard(undefined);
    setAuthError(null);
    setAuthBusy(true);

    redeemDashboardLink(magicToken)
      .then((result) => {
        if (cancelled) return;
        setSessionToken(result.sessionToken);
        setConnectStep("connected");
        setConnectOpen(false);
        window.history.replaceState(null, "", "/dashboard");
      })
      .catch((err) => {
        if (cancelled) return;
        setDashboard(null);
        setConnectStep("join");
        setConnectOpen(true);
        setAuthError(err instanceof Error ? err.message : String(err));
        window.history.replaceState(null, "", "/dashboard");
      })
      .finally(() => {
        if (!cancelled) setAuthBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  const starterMessage = joinMessageText;
  const joinText = encodeURIComponent(starterMessage);
  const joinSmsHref = `sms:${smsNumber(AZRAJ_NUMBER)}?&body=${joinText}`;
  const currentStory = storySteps[activeStep] ?? storySteps[0];

  async function copyText(kind: "number" | "message", value: string) {
    await navigator.clipboard?.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  }

  async function startAuth(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    setAuthNeedsThread(false);
    setDevCode(null);
    try {
      const res = await fetch("/api/public-auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) {
        setAuthNeedsThread(data.code === "otp_delivery_failed");
        throw new Error(String(data.error ?? "couldn't send code"));
      }
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
    setConnectStep("join");
    setAuthNeedsThread(false);
    setVerifiedPhone("");
    setPhone("");
    if (page === "dashboard") navigate("home");
  }

  function openConnect(step: "join" | "signin") {
    setAuthError(null);
    setAuthNeedsThread(false);
    setDevCode(null);
    setCode("");
    if (!sessionToken) setConnectStep(step);
    setConnectOpen(true);
  }

  return (
    <main className={`azraj-page ${page === "dashboard" ? "dashboard-page" : ""}`}>
      <div id="azraj-clouds" className="clouds" aria-hidden="true" />

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
                <button type="button" onClick={() => openConnect("signin")}>
                  sign in
                </button>
                <button type="button" className="nav-auth-primary" onClick={() => openConnect("join")}>
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
          onConnect={() => openConnect("join")}
          onSignOut={signOut}
        />
      ) : (
        <>
          <LandingHero onConnect={() => openConnect("join")} />
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
          needsThread={authNeedsThread}
          copied={copied}
          starterMessage={starterMessage}
          smsHref={joinSmsHref}
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
        <p>text azraj. get your dashboard link. watch your data fill up.</p>
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
  needsThread,
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
  needsThread: boolean;
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
          {step === "connected" && "you're connected"}
          {step === "code" && "Enter Code"}
          {step === "signin" && "Sign in to Azraj"}
          {step === "join" && "Welcome to Azraj"}
        </h2>
        <p className="connect-copy">
          {step === "join" &&
            "Send this exact message below to get started or simply press the Open iMessage button"}
          {step === "signin" && "Enter your phone number and we'll send a 6-digit login code."}
          {step === "code" &&
            `We sent a 6-digit code to ${maskPhone(verifiedPhone || phone)}`}
          {step === "connected" &&
            "send this message to start your accountability thread, then open your dashboard anytime."}
        </p>

        {step === "join" && (
          <div className="connect-form">
            <div className={`text-first-card ${needsThread || busy ? "is-active" : ""}`}>
              <span>{busy ? "creating secure code" : "new secure code"}</span>
              <p>
                Every signup gets a fresh bracket code. Azraj only unlocks the
                dashboard for the phone number that sends it.
              </p>
            </div>

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
          </div>
        )}

        {step === "signin" && (
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
              <span className="sr-only">verification code</span>
              <input
                className="connect-code-input"
                value={code}
                onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="------"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <p className="connect-resend">Resend code in 60s</p>
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

        {error && <p className={`connect-error ${needsThread ? "is-soft" : ""}`}>{error}</p>}
        <p className="connect-help">
          {step === "join" &&
            "Didn't open? Tap to copy the message, then send it to the Azraj number above."}
          {step === "signin" &&
            "Use the same phone number you've already texted Azraj from."}
          {step === "code" &&
            "Didn't get it? Make sure this number has already started an iMessage thread with Azraj."}
          {step === "connected" &&
            "Didn't open? Tap to copy the message, then send it to the Azraj number above."}
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
          <h1>text azraj first</h1>
          <span>send one iMessage and Azraj will reply with your private dashboard link.</span>
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
      <ConsumerDashboardShell
        dashboard={dashboard}
        sessionToken={sessionToken}
        onSignOut={onSignOut}
      />
    </section>
  );
}

function ConsumerDashboardShell({
  dashboard,
  sessionToken,
  onSignOut,
}: {
  dashboard: PublicDashboard;
  sessionToken: string;
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
            {view === "connections" && <ConnectionsView sessionToken={sessionToken} />}
            {view === "accountability" && <AccountabilityView dashboard={dashboard} />}
            {view === "settings" && (
              <SettingsView
                dashboard={dashboard}
                sessionToken={sessionToken}
                onSignOut={onSignOut}
              />
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
  const [viewMode, setViewMode] = useState<MemoryViewMode>("graph");
  const [tierFilter, setTierFilter] = useState<MemoryTierFilter>("all");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allRecords = dashboard.memories;
  const filtered = allRecords.filter((memory) => {
    if (tierFilter !== "all" && memory.tier !== tierFilter) return false;
    if (segmentFilter !== "all" && memory.segment !== segmentFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      memory.content.toLowerCase().includes(q) ||
      memory.memoryId.toLowerCase().includes(q) ||
      memory.segment.toLowerCase().includes(q)
    );
  });

  const btnActive = "bg-zinc-100 text-zinc-950 shadow-sm";
  const btnInactive = "text-zinc-400 hover:bg-white/5 hover:text-zinc-200";

  return (
    <PanelPage
      eyebrow="Store"
      title="Memory"
      description="Search, filter, and inspect the patterns Azraj has saved from your texts."
      stat={<HeaderPill isDark>{filtered.length}/{allRecords.length}</HeaderPill>}
      maxWidth={viewMode === "graph" ? "max-w-none" : "max-w-[1040px]"}
    >
      <div className={panelCardClass(true, "flex flex-wrap items-center gap-2 px-3 py-3")}>
        <div className="segmented-control flex items-center rounded-2xl border border-white/10 bg-[#17171a] p-1">
          {(["table", "graph"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`segmented-button rounded-xl px-2.5 py-1 text-xs capitalize ${
                viewMode === mode ? btnActive : btnInactive
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {MEMORY_TIER_OPTIONS.map((tier) => (
            <button
              key={tier.value}
              type="button"
              onClick={() => setTierFilter(tier.value)}
              className={`segmented-button rounded-xl px-2.5 py-1 text-xs ${
                tierFilter === tier.value ? btnActive : btnInactive
              }`}
            >
              {tier.label}
            </button>
          ))}
        </div>

        <select
          value={segmentFilter}
          onChange={(event) => setSegmentFilter(event.target.value)}
          className="rounded-xl border border-white/10 bg-[#17171a] px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none"
        >
          {MEMORY_SEGMENT_OPTIONS.map((segment) => (
            <option key={segment} value={segment}>
              {segment === "all" ? "All segments" : segment}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search memories..."
          className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-[#17171a] px-3 py-1.5 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SmallStat label="short" value={dashboard.metrics.memories.shortTerm} />
        <SmallStat label="long" value={dashboard.metrics.memories.longTerm} />
        <SmallStat label="permanent" value={dashboard.metrics.memories.permanent} />
      </div>

      {viewMode === "graph" && (
        <div
          className={panelCardClass(
            true,
            "h-[calc(100vh-300px)] min-h-[520px] overflow-hidden",
          )}
        >
          <MemoryGraphView records={filtered} isDark />
        </div>
      )}

      {viewMode === "table" && (
        <div className={panelCardClass(true, "overflow-hidden")}>
          {filtered.length === 0 ? (
            <EmptyState isDark>No records match your filters</EmptyState>
          ) : (
            <div className="divide-y divide-white/10">
              {filtered.map((memory) => {
                const isExpanded = expandedId === memory.memoryId;
                const tierBadge = MEMORY_TIER_BADGE[memory.tier] ?? "";
                const segmentColor = MEMORY_SEGMENT_COLOR[memory.segment] ?? "text-slate-400";

                return (
                  <div
                    key={memory.memoryId}
                    className="cursor-pointer px-5 py-3 transition-colors hover:bg-white/5"
                    onClick={() => setExpandedId(isExpanded ? null : memory.memoryId)}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                          tierBadge
                        }`}
                      >
                        {memory.tier}
                      </span>
                      <span className={`text-[10px] font-semibold ${segmentColor}`}>
                        {memory.segment}
                      </span>
                      <span className={`ml-auto text-[10px] mono ${mutedTextClass(true)}`}>
                        {(memory.importance ?? 0).toFixed(2)}
                      </span>
                      <span className="text-[10px] mono text-zinc-600">
                        {memory.accessCount ?? 0}x
                      </span>
                    </div>

                    <p
                      className={`text-sm text-slate-300 ${
                        isExpanded ? "" : "line-clamp-2"
                      }`}
                    >
                      {memory.content}
                    </p>

                    {isExpanded && (
                      <div className="slide-down mt-3 space-y-2 text-xs">
                        <div className={`grid grid-cols-2 gap-x-6 gap-y-1 ${mutedTextClass(true)}`}>
                          <div>
                            ID: <span className="mono text-slate-400">{memory.memoryId}</span>
                          </div>
                          <div>
                            Decay:{" "}
                            <span className="mono text-slate-400">
                              {memory.decayRate ?? "n/a"}
                            </span>
                          </div>
                          {memory.sourceTurn && (
                            <div>
                              Turn:{" "}
                              <span className="mono text-slate-400">
                                {memory.sourceTurn}
                              </span>
                            </div>
                          )}
                          <div>
                            Created:{" "}
                            <span className="text-slate-400">
                              {new Date(memory.createdAt).toLocaleString()}
                            </span>
                          </div>
                          {memory.lastAccessedAt && (
                            <div>
                              Last accessed:{" "}
                              <span className="text-slate-400">
                                {new Date(memory.lastAccessedAt).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {allRecords.length === 0 && viewMode === "graph" && (
        <div className={subtlePanelClass(true, "px-4 py-10 text-center text-sm text-zinc-500")}>
          no memory yet. azraj saves durable goals and patterns as you talk.
        </div>
      )}
    </PanelPage>
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

function ConnectionsView({ sessionToken }: { sessionToken: string }) {
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [toolsBySlug, setToolsBySlug] = useState<
    Record<string, IntegrationToolSummary[] | "loading" | "error">
  >({});
  const authPollRef = useRef<number | null>(null);

  const loadIntegrations = useCallback(async () => {
    try {
      setError(null);
      const next = await publicAuthPost<IntegrationsResponse>("/integrations", sessionToken);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData({ enabled: false, toolkits: [] });
    }
  }, [sessionToken]);

  useEffect(() => {
    loadIntegrations();
    return () => {
      if (authPollRef.current) window.clearInterval(authPollRef.current);
    };
  }, [loadIntegrations]);

  async function connect(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      const { redirectUrl } = await publicAuthPost<{
        redirectUrl: string | null;
        connectionId: string;
      }>(`/integrations/${slug}/authorize`, sessionToken);
      if (!redirectUrl) {
        await loadIntegrations();
        return;
      }

      const width = 600;
      const height = 720;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        redirectUrl,
        "azraj-composio-auth",
        `width=${width},height=${height},left=${left},top=${top}`,
      );
      if (authPollRef.current) window.clearInterval(authPollRef.current);
      authPollRef.current = window.setInterval(async () => {
        if (!popup || popup.closed) {
          if (authPollRef.current) {
            window.clearInterval(authPollRef.current);
            authPollRef.current = null;
          }
          await loadIntegrations();
          setBusy(null);
        }
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function disconnect(slug: string, connectionId: string) {
    setBusy(`${slug}:${connectionId}`);
    setError(null);
    try {
      await publicAuthPost(`/integrations/${slug}/disconnect`, sessionToken, { connectionId });
      await loadIntegrations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleTools(slug: string) {
    const willExpand = !expanded[slug];
    setExpanded((prev) => ({ ...prev, [slug]: willExpand }));
    if (!willExpand || toolsBySlug[slug]) return;
    setToolsBySlug((prev) => ({ ...prev, [slug]: "loading" }));
    try {
      const result = await publicAuthPost<{ tools: IntegrationToolSummary[] }>(
        `/integrations/${slug}/tools`,
        sessionToken,
      );
      setToolsBySlug((prev) => ({ ...prev, [slug]: result.tools }));
    } catch {
      setToolsBySlug((prev) => ({ ...prev, [slug]: "error" }));
    }
  }

  const toolkits = data?.toolkits ?? [];
  const connectedCount = toolkits.reduce(
    (count, toolkit) =>
      count + toolkit.connections.filter((conn) => conn.status === "ACTIVE").length,
    0,
  );

  return (
    <ConsumerPanel eyebrow="Integrations" title="Connections">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <SmallStat label="connected" value={connectedCount} />
        <SmallStat label="available" value={toolkits.length} />
        <SmallStat label="oauth" value={data?.enabled ? "ready" : "off"} />
        <SmallStat label="scope" value="phone" />
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {!data ? (
        <section className="rounded-2xl border border-white/10 bg-[#1d1d20] p-4 text-sm text-zinc-500">
          loading connections...
        </section>
      ) : !data.enabled ? (
        <section className="rounded-2xl border border-white/10 bg-[#1d1d20] p-4">
          <h3 className="text-sm font-semibold text-zinc-100">Composio is not configured</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Add `COMPOSIO_API_KEY` on the server to let users connect Gmail,
            Calendar, Notion, Slack, GitHub, and more.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {toolkits.map((toolkit) => (
            <IntegrationCard
              key={toolkit.slug}
              toolkit={toolkit}
              busy={busy}
              expanded={Boolean(expanded[toolkit.slug])}
              tools={toolsBySlug[toolkit.slug]}
              onConnect={connect}
              onDisconnect={disconnect}
              onToggleTools={toggleTools}
            />
          ))}
        </section>
      )}
    </ConsumerPanel>
  );
}

function IntegrationCard({
  toolkit,
  busy,
  expanded,
  tools,
  onConnect,
  onDisconnect,
  onToggleTools,
}: {
  toolkit: IntegrationToolkit;
  busy: string | null;
  expanded: boolean;
  tools: IntegrationToolSummary[] | "loading" | "error" | undefined;
  onConnect: (slug: string) => void;
  onDisconnect: (slug: string, connectionId: string) => void;
  onToggleTools: (slug: string) => void;
}) {
  const activeConnections = toolkit.connections.filter((conn) => conn.status === "ACTIVE");
  const pendingConnections = toolkit.connections.filter((conn) => conn.status !== "ACTIVE");
  const isBusy = busy === toolkit.slug;
  const needsSetup =
    toolkit.authMode === "byo" && !toolkit.hasAuthConfig && toolkit.connections.length === 0;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#1d1d20]">
      <div className="flex items-start gap-3 p-4">
        <IntegrationLogoMark toolkit={toolkit} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-zinc-100">
              {toolkit.displayName}
            </h3>
            {activeConnections.length > 0 ? (
              <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                connected
              </span>
            ) : pendingConnections.length > 0 ? (
              <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                pending
              </span>
            ) : (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                not connected
              </span>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
            {toolkit.description ??
              `${toolkit.displayName} tools become available to Azraj after you connect.`}
          </p>
        </div>
        <button
          type="button"
          disabled={isBusy || needsSetup}
          onClick={() => onConnect(toolkit.slug)}
          className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? "opening..." : activeConnections.length > 0 ? "add account" : "connect"}
        </button>
      </div>

      {needsSetup && (
        <div className="border-t border-white/10 bg-amber-400/10 px-4 py-3 text-xs leading-5 text-amber-100">
          This toolkit needs a one-time auth config in Composio before users can connect it.
        </div>
      )}

      {toolkit.connections.length > 0 && (
        <div className="divide-y divide-white/10 border-t border-white/10">
          {toolkit.connections.map((connection) => (
            <div
              key={connection.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-200">
                  {connection.alias ??
                    connection.accountLabel ??
                    connection.accountEmail ??
                    connection.accountName ??
                    "account label unavailable"}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase text-zinc-500">
                  {connection.status}
                </div>
              </div>
              <button
                type="button"
                disabled={busy === `${toolkit.slug}:${connection.id}`}
                onClick={() => onDisconnect(toolkit.slug, connection.id)}
                className="rounded-xl border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                disconnect
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => onToggleTools(toolkit.slug)}
          className="text-xs font-medium text-zinc-400 transition hover:text-zinc-100"
        >
          {expanded ? "hide tools" : `view tools${toolkit.toolCount ? ` (${toolkit.toolCount})` : ""}`}
        </button>
        {expanded && (
          <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3">
            {tools === "loading" && <p className="text-xs text-zinc-500">loading tools...</p>}
            {tools === "error" && (
              <p className="text-xs text-rose-300">could not load this toolkit's tools.</p>
            )}
            {Array.isArray(tools) && (
              <div className="space-y-2">
                {tools.slice(0, 24).map((tool) => (
                  <div key={tool.slug} className="text-xs">
                    <div className="font-mono text-zinc-300">{tool.name}</div>
                    {tool.description && (
                      <p className="mt-1 line-clamp-2 leading-5 text-zinc-500">
                        {tool.description}
                      </p>
                    )}
                  </div>
                ))}
                {tools.length > 24 && (
                  <p className="text-xs text-zinc-500">+{tools.length - 24} more tools</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function IntegrationLogoMark({ toolkit }: { toolkit: IntegrationToolkit }) {
  if (toolkit.logoUrl) {
    return (
      <img
        src={toolkit.logoUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-2xl border border-white/10 bg-white object-contain p-1.5"
      />
    );
  }
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200">
      {toolkit.displayName.slice(0, 1)}
    </div>
  );
}

function SettingsView({
  dashboard,
  sessionToken,
  onSignOut,
}: {
  dashboard: PublicDashboard;
  sessionToken: string;
  onSignOut: () => void;
}) {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const [timezone, setTimezone] = useState(dashboard.user.timezone ?? browserTimezone);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(dashboard.user.timezone ?? browserTimezone);
  }, [browserTimezone, dashboard.user.timezone]);

  async function saveTimezone(nextTimezone = timezone) {
    setStatus("saving");
    setError(null);
    try {
      const result = await publicAuthPost<{ timezone: string }>(
        "/timezone",
        sessionToken,
        { timezone: nextTimezone },
      );
      setTimezone(result.timezone);
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <ConsumerPanel eyebrow="Account" title="Settings">
      <section className="rounded-2xl border border-white/10 bg-[#1d1d20] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <div className="text-[11px] font-medium uppercase text-zinc-500">
              local timezone
            </div>
            <h3 className="mt-1 text-sm font-semibold text-zinc-100">
              keep check-ins anchored to your day
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Azraj uses this for morning plans, afternoon check-ins, night reviews, and
              anything like “today” or “tomorrow.”
            </p>
          </div>

          <div className="w-full max-w-xl space-y-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <select
                value={COMMON_TIMEZONES.some((item) => item.value === timezone) ? timezone : ""}
                onChange={(event) => {
                  if (event.target.value) setTimezone(event.target.value);
                }}
                className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 outline-none transition focus:border-white/25"
              >
                <option value="">custom timezone...</option>
                {COMMON_TIMEZONES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setTimezone(browserTimezone);
                  void saveTimezone(browserTimezone);
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
              >
                use local
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="America/New_York"
                className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 font-mono text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/25"
              />
              <button
                type="button"
                disabled={status === "saving"}
                onClick={() => void saveTimezone()}
                className="rounded-xl border border-white/10 bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "saving" ? "saving..." : "save"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 font-mono text-zinc-400">
                browser: {browserTimezone}
              </span>
              {dashboard.user.timezone ? (
                <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-emerald-300">
                  saved: {dashboard.user.timezone}
                </span>
              ) : (
                <span className="rounded-full bg-amber-400/10 px-2 py-1 text-amber-200">
                  not saved yet
                </span>
              )}
              {status === "saved" && <span className="text-emerald-300">saved</span>}
              {error && <span className="text-rose-300">{error}</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#1d1d20] p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <SmallFact label="phone" value={dashboard.user.phoneE164} />
          <SmallFact label="status" value={dashboard.user.onboardingStatus} />
          <SmallFact label="conversations" value={String(dashboard.conversationIds.length)} />
          <SmallFact label="timezone" value={dashboard.user.timezone ?? "not set"} />
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
