"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  PanelRightClose,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { clearAssistantConversationAction } from "@/app/actions/assistant";
import {
  AgentComposer,
  AgentEmptyState,
  AgentError,
  AgentMessageList,
  AgentToolCard,
  AgentTypingIndicator,
  humanizeToolName,
  type AgentToolPart,
} from "@/components/ai/agent-chat";
import {
  findLatestPendingApproval,
  latestUserTextAfter,
} from "@/components/ai/assistant-approval-state";
import { completedWriteToolCallIds } from "@/components/ai/assistant-data-changes";
import {
  clampAssistantPanelWidth,
  DEFAULT_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
} from "@/components/ai/assistant-panel-width";
import { GeneratedUi } from "@/components/ai/generated-ui";
import {
  calculatePinnedBottomSpacing,
  shouldReleasePinnedMessage,
} from "@/components/ai/pinned-message-layout";
import { TestRunCard } from "@/components/testing/test-run-card";
import { Button } from "@/components/ui/primitives";
import type { RunSnapshot } from "@/lib/testing/runs";
import { cn } from "@/lib/utils";

interface ConfirmationInput {
  title?: unknown;
  description?: unknown;
}

const PINNED_MESSAGE_TOP_INSET = 16;
const PANEL_WIDTH_STORAGE_KEY = "assistant-panel-width";
const PANEL_WIDTH_KEYBOARD_STEP = 24;
const DESKTOP_PANEL_MEDIA_QUERY = "(min-width: 80rem)";
const MAX_WORKSPACE_WIDTH = 1920;
/** Slack in pixels before the transcript counts as scrolled away from the end. */
const SCROLL_TO_BOTTOM_THRESHOLD = 48;
const SUGGESTIONS = [
  "Add a Pro plan at $19/month with a 14-day trial",
  "Give Pro 10,000 points every month",
  "Create an api_calls usage item that resets every 24 hours",
];
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

function ArgumentList({ input }: { input: unknown }) {
  if (!input || typeof input !== "object") return null;
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (entries.length === 0) return null;

  return (
    <dl className="mt-2 space-y-1">
      {entries.map(([key, value]) => {
        const text = typeof value === "object" ? JSON.stringify(value) : String(value);
        // A whole test suite is a legitimate argument, and inlining it would
        // push the approve button off the screen.
        if (text.length > 200) {
          return (
            <div key={key} className="text-xs">
              <dt className="text-neutral-500">{key}</dt>
              <dd className="mt-1">
                <pre className="max-h-48 overflow-auto rounded-lg bg-white/70 p-2 font-mono text-[11px] leading-4 text-neutral-800">
                  {text}
                </pre>
              </dd>
            </div>
          );
        }
        return (
          <div key={key} className="flex gap-2 text-xs">
            <dt className="shrink-0 text-neutral-500">{key}</dt>
            <dd className="min-w-0 flex-1 break-words font-mono text-neutral-800">
              {text}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ConfirmationCard({
  toolPart,
  onResponse,
}: {
  toolPart: AgentToolPart;
  onResponse: (approved: boolean) => void;
}) {
  const input = (toolPart.input ?? {}) as ConfirmationInput;
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title
      : "Confirm change";
  const description =
    typeof input.description === "string" ? input.description : "";
  const cancelled =
    toolPart.state === "output-denied" ||
    (toolPart.state === "approval-responded" &&
      toolPart.approval?.approved === false);
  const approved = toolPart.state === "output-available";
  const failed = toolPart.state === "output-error";

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        cancelled
          ? "border-slate-200 bg-slate-50"
          : failed
            ? "border-rose-200 bg-rose-50/70"
            : approved
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-amber-300 bg-amber-50",
      )}
    >
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      {description ? (
        <p className="mt-1.5 text-sm leading-6 text-slate-600">{description}</p>
      ) : null}

      {toolPart.state === "approval-requested" ? (
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => onResponse(true)}>
            <Check className="size-3.5" aria-hidden="true" />
            Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onResponse(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <p
          className={cn(
            "mt-3 text-xs font-medium",
            cancelled
              ? "text-slate-500"
              : failed
                ? "text-rose-700"
                : approved
                  ? "text-emerald-700"
                  : "text-blue-700",
          )}
        >
          {cancelled
            ? "Cancelled"
            : failed
              ? toolPart.errorText ?? "Confirmation failed"
              : approved
                ? "Approved"
                : "Confirming…"}
        </p>
      )}
    </div>
  );
}

function ApprovalCard({
  label,
  toolPart,
  onResponse,
}: {
  label: string;
  toolPart: AgentToolPart;
  onResponse: (approved: boolean) => void;
}) {
  const output = toolPart.output as { ok?: boolean; error?: string } | null;
  const outputFailed = toolPart.state === "output-available" && output?.ok === false;

  const presentation = outputFailed
    ? {
        label: "Failed",
        icon: XCircle,
        card: "border-rose-200 bg-rose-50/70",
        title: "text-rose-950",
        badge: "bg-rose-100 text-rose-700",
      }
    : toolPart.state === "output-error"
      ? {
          label: "Failed",
          icon: XCircle,
          card: "border-rose-200 bg-rose-50/70",
          title: "text-rose-950",
          badge: "bg-rose-100 text-rose-700",
        }
      : toolPart.state === "output-denied" ||
          (toolPart.state === "approval-responded" &&
            toolPart.approval?.approved === false)
        ? {
            label: "Rejected",
            icon: XCircle,
            card: "border-slate-200 bg-slate-50",
            title: "text-slate-900",
            badge: "bg-slate-200/70 text-slate-600",
          }
        : toolPart.state === "output-available"
          ? {
              label: "Applied",
              icon: CheckCircle2,
              card: "border-emerald-200 bg-emerald-50/70",
              title: "text-emerald-950",
              badge: "bg-emerald-100 text-emerald-700",
            }
          : toolPart.state === "approval-responded"
            ? {
                label: "Applying",
                icon: Loader2,
                card: "border-blue-200 bg-blue-50/70",
                title: "text-blue-950",
                badge: "bg-blue-100 text-blue-700",
              }
            : {
                label: "Confirmation required",
                icon: null,
                card: "border-amber-300 bg-amber-50",
                title: "text-amber-950",
                badge: "bg-amber-100 text-amber-700",
              };

  const StatusIcon = presentation.icon;
  const errorMessage = outputFailed ? output?.error : toolPart.errorText;

  return (
    <div className={cn("rounded-xl border p-3.5", presentation.card)}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-sm font-semibold", presentation.title)}>{label}</p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold",
            presentation.badge,
          )}
        >
          {StatusIcon ? (
            <StatusIcon
              className={cn(
                "size-3",
                presentation.label === "Applying" && "animate-spin",
              )}
              aria-hidden="true"
            />
          ) : null}
          {presentation.label}
        </span>
      </div>

      <ArgumentList input={toolPart.input} />

      {errorMessage ? (
        <p className="mt-2 text-xs leading-5 text-rose-700">{errorMessage}</p>
      ) : null}

      {toolPart.state === "approval-requested" ? (
        <div className="mt-3 flex gap-2 border-t border-amber-200 pt-3">
          <Button size="sm" onClick={() => onResponse(true)}>
            <Check className="size-3.5" aria-hidden="true" />
            Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onResponse(false)}>
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AssistantPanel({
  applicationId,
  applicationName,
  initialMessages,
  runSnapshots,
}: {
  applicationId: string;
  applicationName: string;
  initialMessages: UIMessage[];
  /**
   * The runs already mentioned in the stored transcript, read on the server.
   * A card for a run that had finished by then draws itself from this and
   * asks for nothing — the alternative being that opening the panel reopens
   * every run in the history at once.
   */
  runSnapshots?: Record<string, RunSnapshot>;
}) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(true);
  const [desktopViewport, setDesktopViewport] = useState(false);
  const [draft, setDraft] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [pinnedUserMessageId, setPinnedUserMessageId] = useState<string | null>(
    null,
  );
  const [bottomSpacing, setBottomSpacing] = useState(0);
  // Writes already in the stored conversation shaped the page that just
  // rendered, so only later ones should trigger a refresh.
  const [refreshedToolCalls] = useState(
    () => new Set(completedWriteToolCallIds(initialMessages)),
  );
  // Restore the stored width after hydration so local storage never affects
  // the server-rendered shell.
  const [panelWidth, setPanelWidth] = useState(DEFAULT_ASSISTANT_PANEL_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // Set once the reader scrolls by hand, so streaming never yanks the
  // transcript back under them.
  const readerScrolledRef = useRef(false);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const pinnedUserMessageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelWidthRef = useRef(panelWidth);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    addToolApprovalResponse,
    clearError: clearChatError,
    error,
  } = useChat({
    id: `assistant:${applicationId}`,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { applicationId },
    }),
    // Once an approval is answered, continue the run without another user turn.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const busy = status === "streaming" || status === "submitted";
  const panelActive = desktopViewport ? !desktopCollapsed : mobileOpen;
  const pendingApproval = findLatestPendingApproval(messages);
  const agentStatus = busy
    ? { label: "Working", color: "animate-pulse bg-amber-400" }
    : pendingApproval
      ? { label: "Needs approval", color: "bg-amber-400" }
      : { label: "Ready", color: "bg-emerald-500" };
  const messagesThroughPendingApproval = pendingApproval
    ? messages.slice(0, pendingApproval.messageIndex + 1)
    : [];
  const canResumePendingApproval =
    pendingApproval !== null &&
    lastAssistantMessageIsCompleteWithApprovalResponses({
      messages: messagesThroughPendingApproval,
    });

  const updatePinnedLayout = useCallback(() => {
    if (!panelActive || !pinnedUserMessageId) return;

    const viewport = messagesViewportRef.current;
    const pinnedMessage = pinnedUserMessageRef.current;
    const content = messagesContentRef.current;
    if (!viewport || !pinnedMessage || !content) return;

    const viewportRect = viewport.getBoundingClientRect();
    const pinnedRect = pinnedMessage.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const pinnedOffsetTop = pinnedRect.top - viewportRect.top + viewport.scrollTop;
    const targetScrollTop = Math.max(
      0,
      pinnedOffsetTop - PINNED_MESSAGE_TOP_INSET,
    );
    // scrollHeight is clamped to clientHeight when a new conversation is
    // short. Measure the transcript itself so the spacer never feeds back
    // into this calculation and grows once per layout pass.
    const viewportPaddingBottom = Number.parseFloat(
      window.getComputedStyle(viewport).paddingBottom,
    );
    const contentHeightWithoutSpacer =
      contentRect.bottom -
      viewportRect.top +
      viewport.scrollTop +
      (Number.isFinite(viewportPaddingBottom) ? viewportPaddingBottom : 0);
    const requiredSpacing = calculatePinnedBottomSpacing({
      viewportHeight: viewport.clientHeight,
      targetScrollTop,
      contentHeightWithoutSpacer,
    });

    const pinnedIndex = messages.findIndex(
      (message) => message.id === pinnedUserMessageId,
    );
    const hasContentAfterPinnedMessage = messages
      .slice(pinnedIndex + 1)
      .some((message) => message.parts.length > 0);

    // A long user message may need no spacer by itself. Keep it pinned until a
    // real response exists, then release once the reply fills the viewport.
    if (
      shouldReleasePinnedMessage(requiredSpacing, hasContentAfterPinnedMessage)
    ) {
      setBottomSpacing(0);
      setPinnedUserMessageId(null);
      return;
    }

    setBottomSpacing((currentSpacing) =>
      currentSpacing === requiredSpacing ? currentSpacing : requiredSpacing,
    );
    if (!readerScrolledRef.current) viewport.scrollTo({ top: targetScrollTop });
  }, [messages, panelActive, pinnedUserMessageId]);

  const updateScrollAffordance = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;

    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setShowScrollToBottom(distanceFromBottom > SCROLL_TO_BOTTOM_THRESHOLD);
  }, []);

  useLayoutEffect(() => {
    updatePinnedLayout();
  }, [bottomSpacing, status, updatePinnedLayout]);

  useEffect(() => {
    if (!panelActive) return;

    const viewport = messagesViewportRef.current;
    const content = messagesContentRef.current;
    if (!viewport || !content) return;

    let animationFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        updatePinnedLayout();
        // Streaming grows the transcript without firing a scroll event.
        updateScrollAffordance();
      });
    });
    observer.observe(viewport);
    observer.observe(content);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [panelActive, updatePinnedLayout, updateScrollAffordance]);

  // Opening lands on the latest message; after that the transcript only moves
  // when the reader asks it to.
  useLayoutEffect(() => {
    if (!panelActive) return;

    readerScrolledRef.current = false;
    const jumpToEnd = () => {
      const viewport = messagesViewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
      updateScrollAffordance();
    };
    jumpToEnd();
    // Markdown and tool cards settle a frame later, changing the end position.
    const animationFrame = requestAnimationFrame(jumpToEnd);
    return () => cancelAnimationFrame(animationFrame);
  }, [panelActive, updateScrollAffordance]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_PANEL_MEDIA_QUERY);
    const updateViewport = () => setDesktopViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      const storedWidth = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
      if (!storedWidth) return;

      const next = clampAssistantPanelWidth(
        Number(storedWidth),
        Math.min(window.innerWidth, MAX_WORKSPACE_WIDTH),
      );
      panelWidthRef.current = next;
      setPanelWidth(next);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    const unseenWrites = completedWriteToolCallIds(messages).filter(
      (toolCallId) => !refreshedToolCalls.has(toolCallId),
    );
    if (unseenWrites.length === 0) return;

    for (const toolCallId of unseenWrites) refreshedToolCalls.add(toolCallId);
    // The assistant changed data this route rendered from; re-fetch it so the
    // page behind the panel shows the change without a manual reload.
    router.refresh();
  }, [messages, refreshedToolCalls, router]);

  useEffect(() => {
    if (!panelActive) return;

    // A narrower workspace shrinks the panel without overwriting the stored width.
    const handleViewportResize = () => {
      const workspaceWidth =
        panelRef.current?.parentElement?.clientWidth ??
        Math.min(window.innerWidth, MAX_WORKSPACE_WIDTH);
      setPanelWidth((width) => {
        const next = clampAssistantPanelWidth(width, workspaceWidth);
        panelWidthRef.current = next;
        return next;
      });
    };
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, [panelActive]);

  function storePanelWidth(width: number) {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(width));
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!resizing) return;
    const panelRight =
      panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    const workspaceWidth =
      panelRef.current?.parentElement?.clientWidth ??
      Math.min(window.innerWidth, MAX_WORKSPACE_WIDTH);
    const next = clampAssistantPanelWidth(
      panelRight - event.clientX,
      workspaceWidth,
    );
    panelWidthRef.current = next;
    setPanelWidth(next);
  }

  function endResize(event: PointerEvent<HTMLDivElement>) {
    if (!resizing) return;
    // A cancelled pointer has already lost capture.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
    storePanelWidth(panelWidthRef.current);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    // The panel is anchored right, so dragging the handle left widens it.
    const step =
      event.key === "ArrowLeft"
        ? PANEL_WIDTH_KEYBOARD_STEP
        : event.key === "ArrowRight"
          ? -PANEL_WIDTH_KEYBOARD_STEP
          : 0;
    if (step === 0) return;

    event.preventDefault();
    const next = clampAssistantPanelWidth(
      panelWidth + step,
      panelRef.current?.parentElement?.clientWidth ??
        Math.min(window.innerWidth, MAX_WORKSPACE_WIDTH),
    );
    panelWidthRef.current = next;
    setPanelWidth(next);
    storePanelWidth(next);
  }

  /** Any hand-driven scroll hands control of the transcript to the reader. */
  function noteReaderScroll() {
    readerScrolledRef.current = true;
  }

  function noteReaderScrollKey(event: KeyboardEvent<HTMLDivElement>) {
    if (SCROLL_KEYS.has(event.key)) readerScrolledRef.current = true;
  }

  function noteReaderScrollbarDrag(event: PointerEvent<HTMLDivElement>) {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    // Only a press in the scrollbar gutter scrolls; clicks on cards do not.
    const offsetX = event.clientX - viewport.getBoundingClientRect().left;
    if (offsetX > viewport.clientWidth) readerScrolledRef.current = true;
  }

  function scrollToBottom() {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;

    // The spacer only exists to hold a pinned message at the top, so drop it
    // rather than scrolling the reader into blank space.
    setPinnedUserMessageId(null);
    setBottomSpacing(0);
    readerScrolledRef.current = true;
    requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    });
  }

  function submit() {
    const text = draft.trim();
    if (!text || busy || pendingApproval) return;
    const messageId = crypto.randomUUID();
    setDraft("");
    setBottomSpacing(0);
    // Sending is an explicit request to see the new turn.
    readerScrolledRef.current = false;
    setPinnedUserMessageId(messageId);
    void sendMessage({
      id: messageId,
      role: "user",
      parts: [{ type: "text", text }],
    });
  }

  /** Cancel the in-flight response, keeping whatever it already streamed. */
  async function stopResponse() {
    if (!busy) return;
    await stop();
    setPinnedUserMessageId(null);
    setBottomSpacing(0);
  }

  async function resumePendingApproval() {
    if (!pendingApproval || !canResumePendingApproval || busy) return;

    const deferredUserText = latestUserTextAfter(
      messages,
      pendingApproval.messageIndex,
    );
    if (deferredUserText) {
      setDraft((currentDraft) => {
        if (!currentDraft.trim()) return deferredUserText;
        if (currentDraft.trim() === deferredUserText.trim()) return currentDraft;
        return `${deferredUserText}\n\n${currentDraft}`;
      });
    }

    // A failed follow-up can leave a user message after the approval response.
    // Remove it from the protocol before retrying, but preserve its text above.
    setMessages(messagesThroughPendingApproval);
    setPinnedUserMessageId(null);
    setBottomSpacing(0);
    clearChatError();
    await sendMessage();
  }

  async function clearConversation() {
    if (busy || clearing || messages.length === 0) return;
    if (!window.confirm("Clear this assistant conversation? This cannot be undone.")) {
      return;
    }

    setClearing(true);
    setClearError(null);
    try {
      await clearAssistantConversationAction(applicationId);
      setPinnedUserMessageId(null);
      setBottomSpacing(0);
      setMessages([]);
    } catch (clearConversationError) {
      console.error("Failed to clear assistant conversation:", clearConversationError);
      setClearError("The conversation could not be cleared. Please try again.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      {!mobileOpen ? (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open subscription assistant"
          className="fixed bottom-6 right-6 z-40 flex size-12 items-center justify-center rounded-full bg-slate-950 text-white shadow-lg shadow-slate-950/20 transition hover:bg-slate-800 xl:hidden"
        >
          <Bot className="size-5" aria-hidden="true" />
        </button>
      ) : null}

      {desktopCollapsed ? (
        <button
          type="button"
          onClick={() => setDesktopCollapsed(false)}
          aria-label="Open subscription assistant"
          className="fixed bottom-6 right-6 z-40 hidden size-12 items-center justify-center rounded-full bg-slate-950 text-white shadow-lg shadow-slate-950/20 transition hover:bg-slate-800 xl:flex"
        >
          <Bot className="size-5" aria-hidden="true" />
        </button>
      ) : null}

    <aside
      ref={panelRef}
      style={
        { "--assistant-panel-width": `${panelWidth}px` } as CSSProperties
      }
      className={cn(
        "relative z-50 w-full flex-col overflow-hidden border-l border-slate-200/80 bg-white",
        mobileOpen
          ? "fixed inset-y-0 right-0 flex shadow-2xl"
          : "hidden",
        desktopCollapsed
          ? "xl:hidden"
          : "xl:sticky xl:top-0 xl:z-40 xl:flex xl:h-screen xl:w-[var(--assistant-panel-width)] xl:shrink-0 xl:self-start xl:shadow-none",
        resizing && "select-none",
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant panel"
        aria-valuenow={panelWidth}
        aria-valuemin={MIN_ASSISTANT_PANEL_WIDTH}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={resizeWithKeyboard}
        className={cn(
          "absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none xl:block",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-blue-400 focus-visible:after:bg-blue-500",
          resizing ? "after:bg-blue-500" : "after:bg-transparent",
        )}
      />

      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-600/20">
            <Bot className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-950">Workspace agent</p>
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", agentStatus.color)}
                aria-hidden="true"
              />
              <span className="shrink-0">{agentStatus.label}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{applicationName}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void clearConversation()}
            disabled={busy || clearing || messages.length === 0}
            aria-label="Clear assistant conversation"
          >
            {clearing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-3.5" aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 xl:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close workspace agent"
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-8 xl:inline-flex"
            onClick={() => setDesktopCollapsed(true)}
            aria-label="Collapse workspace agent"
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>
      </header>

      <div
        ref={messagesViewportRef}
        className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-4 pb-32 pt-5"
        aria-live="polite"
        onScroll={updateScrollAffordance}
        onWheel={noteReaderScroll}
        onTouchMove={noteReaderScroll}
        onKeyDown={noteReaderScrollKey}
        onPointerDown={noteReaderScrollbarDrag}
      >
        <AgentMessageList
          messages={messages}
          contentRef={messagesContentRef}
          messageRef={(messageId) =>
            messageId === pinnedUserMessageId ? pinnedUserMessageRef : undefined
          }
          empty={
            <AgentEmptyState
              title="Build your subscription setup"
              description="Ask the agent to create, connect, or explain anything in this workspace."
              suggestions={SUGGESTIONS}
              onSuggestionSelect={setDraft}
            />
          }
          renderToolPart={({ part }) => {
            const label = humanizeToolName(part.type);

            // A generated view replaces the tool card entirely — the point
            // of the call is the chart, not a "done" line.
            if (part.type === "tool-renderUI") {
              const output = part.output as { ok?: boolean } | null;
              if (
                part.state === "output-error" ||
                part.state === "output-denied"
              ) {
                return null;
              }
              if (part.state !== "output-available") {
                return <AgentToolCard label="Preparing view…" status="running" />;
              }
              if (!output?.ok) return null;
              const input = part.input as { spec?: unknown } | null;
              return <GeneratedUi spec={input?.spec} />;
            }

            // An approved run replaces its "Applied" card with the live run
            // itself — the point of the call is watching it, not being told
            // it started.
            if (
              part.type === "tool-runTestSuite" &&
              part.state === "output-available"
            ) {
              const output = part.output as {
                ok?: boolean;
                result?: { runId?: string; suiteName?: string };
              } | null;
              if (output?.ok && output.result?.runId) {
                return (
                  <TestRunCard
                    runId={output.result.runId}
                    initial={runSnapshots?.[output.result.runId] ?? null}
                    suiteName={output.result.suiteName}
                    applicationId={applicationId}
                    compact
                  />
                );
              }
            }

            if (part.type === "tool-confirmation" && part.approval) {
              const approvalId = part.approval.id;
              return (
                <ConfirmationCard
                  toolPart={part}
                  onResponse={(approved) => {
                    clearChatError();
                    void addToolApprovalResponse({ id: approvalId, approved });
                  }}
                />
              );
            }

            // Write tools keep their existing detailed approval card.
            if (part.approval) {
              const approvalId = part.approval.id;
              return (
                <ApprovalCard
                  label={label}
                  toolPart={part}
                  onResponse={(approved) => {
                    clearChatError();
                    void addToolApprovalResponse({ id: approvalId, approved });
                  }}
                />
              );
            }

            if (part.state === "output-denied") {
              return <AgentToolCard label={`${label} — rejected`} status="skipped" />;
            }

            if (part.state === "output-error") {
              return (
                <AgentToolCard
                  label={`${label} — ${part.errorText ?? "failed"}`}
                  status="failed"
                />
              );
            }

            if (part.state === "output-available") {
              const output = part.output as {
                ok?: boolean;
                error?: string;
              } | null;
              if (output && output.ok === false) {
                return (
                  <AgentToolCard
                    label={`${label} — ${output.error}`}
                    status="failed"
                  />
                );
              }
              return <AgentToolCard label={label} status="done" />;
            }

            return <AgentToolCard label={`${label}…`} status="running" />;
          }}
        >
          {busy ? <AgentTypingIndicator /> : null}

          {canResumePendingApproval && !busy ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p className="font-medium">
                This confirmed change is waiting to finish.
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-700">
                Resume it before sending another message. Any failed follow-up
                will be returned to the composer.
              </p>
              <Button
                className="mt-3"
                size="sm"
                onClick={() => void resumePendingApproval()}
              >
                Resume change
              </Button>
            </div>
          ) : null}

          {error && !canResumePendingApproval ? (
            <AgentError>{error.message}</AgentError>
          ) : null}
          {clearError ? <AgentError>{clearError}</AgentError> : null}
        </AgentMessageList>
        <div
          style={{ height: bottomSpacing }}
          aria-hidden="true"
        />
      </div>

      {showScrollToBottom ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to latest message"
          className="absolute bottom-28 left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition hover:bg-slate-50 hover:text-slate-950"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </button>
      ) : null}

      <AgentComposer
        className="absolute inset-x-3 bottom-3 z-10"
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        onStop={() => void stopResponse()}
        busy={busy}
        disabled={pendingApproval !== null}
        label="Message the workspace agent"
        placeholder={
          pendingApproval
            ? canResumePendingApproval
              ? "Resume the pending change first"
              : "Approve or reject the pending change first"
            : "Ask the agent…"
        }
      />
    </aside>
    </>
  );
}
