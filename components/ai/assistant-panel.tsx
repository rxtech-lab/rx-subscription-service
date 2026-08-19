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
  Send,
  Sparkles,
  Square,
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
import { MarkdownMessage } from "@/components/ai/markdown-message";
import {
  calculatePinnedBottomSpacing,
  shouldReleasePinnedMessage,
} from "@/components/ai/pinned-message-layout";
import { TestRunCard } from "@/components/testing/test-run-card";
import { Button } from "@/components/ui/primitives";
import type { RunSnapshot } from "@/lib/testing/runs";
import { cn } from "@/lib/utils";

interface DisplayToolPart {
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean };
}

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
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/** Turn `createPlan` into `Create plan` for the approval card. */
function humanizeTool(name: string): string {
  const bare = name.replace(/^tool-/, "");
  const spaced = bare.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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
  toolPart: DisplayToolPart;
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
  toolPart: DisplayToolPart;
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

function TypingIndicator() {
  return (
    <div
      className="flex items-center gap-1 py-2"
      role="status"
      aria-label="Assistant is responding"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${index * 140}ms` }}
          aria-hidden="true"
        />
      ))}
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
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
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
    const spacer = bottomSpacerRef.current;
    if (!viewport || !pinnedMessage || !spacer) return;

    const viewportRect = viewport.getBoundingClientRect();
    const pinnedRect = pinnedMessage.getBoundingClientRect();
    const pinnedOffsetTop = pinnedRect.top - viewportRect.top + viewport.scrollTop;
    const targetScrollTop = Math.max(
      0,
      pinnedOffsetTop - PINNED_MESSAGE_TOP_INSET,
    );
    const requiredSpacing = calculatePinnedBottomSpacing({
      viewportHeight: viewport.clientHeight,
      targetScrollTop,
      scrollHeight: viewport.scrollHeight,
      currentSpacerHeight: spacer.getBoundingClientRect().height,
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
        <div ref={messagesContentRef} className="space-y-4">
          {messages.length === 0 ? (
            <div className="mx-auto flex max-w-sm flex-col items-center px-1 py-6 text-center">
              <span className="flex size-11 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600">
                <Sparkles className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-4 text-sm font-semibold text-slate-950">
                Build your subscription setup
              </p>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                Ask the agent to create, connect, or explain anything in this
                workspace.
              </p>
              <div className="mt-5 grid w-full gap-2 text-left">
                {[
                  "Add a Pro plan at $19/month with a 14-day trial",
                  "Give Pro 10,000 points every month",
                  "Create an api_calls usage item that resets every 24 hours",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setDraft(suggestion)}
                    className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-xs leading-5 text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-blue-200 hover:text-slate-950 hover:shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <div
              key={message.id}
              ref={
                message.id === pinnedUserMessageId
                  ? pinnedUserMessageRef
                  : undefined
              }
              className="space-y-2"
            >
              {message.role === "assistant" ? (
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  <span className="flex size-5 items-center justify-center rounded-md bg-blue-100 text-blue-600">
                    <Bot className="size-3" aria-hidden="true" />
                  </span>
                  Agent
                </div>
              ) : null}
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  if (message.role !== "user") {
                    return (
                      <div key={index} className="w-full pr-0 text-sm">
                        <MarkdownMessage>{part.text}</MarkdownMessage>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={index}
                      className="ml-auto w-fit max-w-[calc(100%-2rem)] break-words whitespace-pre-wrap rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2.5 text-sm text-white shadow-sm shadow-blue-600/10"
                    >
                      {part.text}
                    </div>
                  );
                }

                if (!part.type.startsWith("tool-")) return null;
                const toolPart = part as typeof part & DisplayToolPart;
                const label = humanizeTool(part.type);

                // A generated view replaces the tool card entirely — the point
                // of the call is the chart, not a "done" line.
                if (part.type === "tool-renderUI") {
                  const output = toolPart.output as { ok?: boolean } | null;
                  if (
                    toolPart.state === "output-error" ||
                    toolPart.state === "output-denied"
                  ) {
                    return null;
                  }
                  if (toolPart.state !== "output-available") {
                    return (
                      <p key={index} className="text-xs text-neutral-400">
                        Preparing view…
                      </p>
                    );
                  }
                  if (!output?.ok) return null;
                  const input = toolPart.input as { spec?: unknown } | null;
                  return <GeneratedUi key={index} spec={input?.spec} />;
                }

                // An approved run replaces its "Applied" card with the live run
                // itself — the point of the call is watching it, not being told
                // it started.
                if (
                  part.type === "tool-runTestSuite" &&
                  toolPart.state === "output-available"
                ) {
                  const output = toolPart.output as {
                    ok?: boolean;
                    result?: { runId?: string; suiteName?: string };
                  } | null;
                  if (output?.ok && output.result?.runId) {
                    return (
                      <TestRunCard
                        key={index}
                        runId={output.result.runId}
                        initial={runSnapshots?.[output.result.runId] ?? null}
                        suiteName={output.result.suiteName}
                        applicationId={applicationId}
                        compact
                      />
                    );
                  }
                }

                if (part.type === "tool-confirmation" && toolPart.approval) {
                  const approvalId = toolPart.approval.id;
                  return (
                    <ConfirmationCard
                      key={index}
                      toolPart={toolPart}
                      onResponse={(approved) => {
                        clearChatError();
                        void addToolApprovalResponse({ id: approvalId, approved });
                      }}
                    />
                  );
                }

                // Write tools keep their existing detailed approval card.
                if (toolPart.approval) {
                  const approvalId = toolPart.approval.id;
                  return (
                    <ApprovalCard
                      key={index}
                      label={label}
                      toolPart={toolPart}
                      onResponse={(approved) => {
                        clearChatError();
                        void addToolApprovalResponse({ id: approvalId, approved });
                      }}
                    />
                  );
                }

                if (toolPart.state === "output-denied") {
                  return (
                    <p key={index} className="text-xs text-neutral-500">
                      {label} — rejected
                    </p>
                  );
                }

                if (toolPart.state === "output-error") {
                  return (
                    <p key={index} className="text-xs text-red-600">
                      {label} — {toolPart.errorText ?? "failed"}
                    </p>
                  );
                }

                if (toolPart.state === "output-available") {
                  const output = toolPart.output as {
                    ok?: boolean;
                    error?: string;
                  } | null;
                  if (output && output.ok === false) {
                    return (
                      <p key={index} className="text-xs text-red-600">
                        {label} — {output.error}
                      </p>
                    );
                  }
                  return (
                    <p key={index} className="text-xs text-neutral-500">
                      {label} — done
                    </p>
                  );
                }

                return (
                  <p key={index} className="text-xs text-neutral-400">
                    {label}…
                  </p>
                );
              })}
            </div>
          ))}

          {busy ? <TypingIndicator /> : null}

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
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error.message}
            </p>
          ) : null}
          {clearError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {clearError}
            </p>
          ) : null}
        </div>
        <div
          ref={bottomSpacerRef}
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

      <form
        className="absolute inset-x-3 bottom-3 z-10 flex items-end gap-2 rounded-2xl border border-slate-200/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(241,245,249,0.42))] p-2 backdrop-blur-2xl backdrop-saturate-150 transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-100/70"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          disabled={busy || pendingApproval !== null}
          placeholder={
            pendingApproval
              ? canResumePendingApproval
                ? "Resume the pending change first"
                : "Approve or reject the pending change first"
              : "Ask the agent…"
          }
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
        {busy ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="size-9 shrink-0 shadow-none"
            onClick={() => void stopResponse()}
            aria-label="Stop response"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0 shadow-none"
            disabled={pendingApproval !== null || !draft.trim()}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
    </aside>
    </>
  );
}
