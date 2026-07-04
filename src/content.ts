import { shouldShowChart } from "./api/bitbucket";
import { renderError, renderHeatmap, renderLoading } from "./chart";
import type { ContributionResponse, MessageRequest, MessageResponse } from "./types";

const WIDGET_ID = "bbcc-contribution-widget";
const FETCH_TIMEOUT_MS = 30 * 60 * 1000;

let injectionChecked = false;
let injectOnThisPage = false;
let loading = false;
let pendingResult: ((response: ContributionResponse) => void) | null = null;
let dismissListenersBound = false;

function sendMessage<T extends MessageResponse>(
  message: Record<string, unknown>,
): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function isVisible(): boolean {
  const widget = document.getElementById(WIDGET_ID);
  return Boolean(widget && !widget.classList.contains("bbcc-hidden"));
}

function mountWidget(): HTMLElement {
  let widget = document.getElementById(WIDGET_ID);
  if (widget) return widget;

  widget = document.createElement("section");
  widget.id = WIDGET_ID;
  widget.className = "bbcc-widget bbcc-popover";
  widget.setAttribute("role", "dialog");
  widget.setAttribute("aria-label", "Bitbucket contribution chart");
  widget.setAttribute("aria-modal", "false");
  document.body.appendChild(widget);

  bindDismissListeners();
  return widget;
}

function bindDismissListeners(): void {
  if (dismissListenersBound) return;
  dismissListenersBound = true;

  document.addEventListener("mousedown", (e) => {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget || widget.classList.contains("bbcc-hidden")) return;
    if (widget.contains(e.target as Node)) return;
    hideWidget();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!isVisible()) return;
    hideWidget();
  });
}

function hideWidget(): void {
  const widget = document.getElementById(WIDGET_ID);
  widget?.classList.add("bbcc-hidden");
}

function showWidget(): HTMLElement {
  const widget = mountWidget();
  widget.classList.remove("bbcc-hidden");
  return widget;
}

function waitForContributionResult(): Promise<ContributionResponse> {
  return new Promise((resolve) => {
    pendingResult = resolve;
    window.setTimeout(() => {
      if (pendingResult === resolve) {
        pendingResult = null;
        resolve({
          type: "error",
          message:
            "Scan timed out. Try Refresh — large accounts can take several minutes.",
        });
      }
    }, FETCH_TIMEOUT_MS);
  });
}

function deliverPending(response: ContributionResponse): void {
  if (pendingResult) {
    const resolve = pendingResult;
    pendingResult = null;
    resolve(response);
  }
}

function bindPopoverActions(widget: HTMLElement, onRefresh: () => void): void {
  widget.querySelector(".bbcc-refresh")?.addEventListener("click", onRefresh);
  widget.querySelector(".bbcc-retry")?.addEventListener("click", onRefresh);
  widget.querySelector(".bbcc-close")?.addEventListener("click", hideWidget);
  widget.querySelector(".bbcc-options-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

function handleContributionResponse(
  widget: HTMLElement,
  response: ContributionResponse,
  onRefresh: () => void,
): void {
  if (response.type === "error") {
    renderError(widget, response.message, response.needsAuth);
    bindPopoverActions(widget, onRefresh);
    return;
  }

  if (response.type === "result") {
    renderHeatmap(widget, {
      dailyCounts: response.dailyCounts,
      totalCommits: response.totalCommits,
      partial: response.partial,
      fromCache: response.fromCache,
    });
    bindPopoverActions(widget, onRefresh);
  }
}

async function ensureInjectionAllowed(): Promise<boolean> {
  if (injectionChecked) return injectOnThisPage;

  if (!shouldShowChart()) {
    injectionChecked = true;
    injectOnThisPage = false;
    return false;
  }

  const userRes = await sendMessage({
    action: "getUser",
  });

  if (!("ok" in userRes) || !userRes.ok || !("user" in userRes) || !userRes.user) {
    injectionChecked = true;
    injectOnThisPage = true;
    const widget = showWidget();
    const err =
      "error" in userRes && typeof userRes.error === "string"
        ? userRes.error
        : "Configure your API token in extension options.";
    renderError(widget, err, true);
    bindPopoverActions(widget, () => {
      injectionChecked = false;
      injectOnThisPage = false;
      void loadContributions();
    });
    return false;
  }

  injectOnThisPage = true;
  injectionChecked = true;
  return true;
}

async function loadContributions(refresh = false): Promise<void> {
  if (loading) return;

  const allowed = await ensureInjectionAllowed();
  if (!allowed) return;

  loading = true;
  const widget = showWidget();
  renderLoading(widget, 0, 0, "", "listing");

  try {
    const response = await sendMessage<ContributionResponse>({
      action: "getContributions",
      refresh,
    });

    if (response.type === "started") {
      const final = await waitForContributionResult();
      handleContributionResponse(widget, final, () => loadContributions(true));
      return;
    }

    handleContributionResponse(widget, response, () => loadContributions(true));
  } finally {
    loading = false;
  }
}

async function toggleChart(): Promise<void> {
  if (isVisible()) {
    hideWidget();
    return;
  }

  injectionChecked = false;
  injectOnThisPage = false;
  await loadContributions();
}

chrome.runtime.onMessage.addListener(
  (msg: MessageRequest | ContributionResponse) => {
    if ("action" in msg && msg.action === "toggleChart") {
      void toggleChart();
      return;
    }

    if (!("type" in msg)) return;

    if (msg.type === "progress") {
      const widget = document.getElementById(WIDGET_ID);
      if (!widget || widget.classList.contains("bbcc-hidden")) return;
      renderLoading(
        widget,
        msg.done,
        msg.total,
        msg.repoName,
        msg.phase ?? "scanning",
      );
      return;
    }

    if (msg.type === "result" || msg.type === "error") {
      deliverPending(msg);
      if (!pendingResult) {
        const widget = document.getElementById(WIDGET_ID);
        if (widget && !widget.classList.contains("bbcc-hidden")) {
          handleContributionResponse(widget, msg, () => loadContributions(true));
        }
      }
    }
  },
);

let lastPath = location.pathname;

function onRouteChange(): void {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  injectionChecked = false;
  injectOnThisPage = false;
  dismissListenersBound = false;
  document.getElementById(WIDGET_ID)?.remove();
}

const routeObserver = new MutationObserver(() => onRouteChange());
routeObserver.observe(document.body, { childList: true, subtree: true });

window.addEventListener("popstate", onRouteChange);

for (const method of ["pushState", "replaceState"] as const) {
  const original = history[method].bind(history);
  history[method] = (...args: Parameters<History["pushState"]>) => {
    original(...args);
    onRouteChange();
  };
}
