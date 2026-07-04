import {
  fetchCurrentUser,
  listMemberRepos,
  mergeDailyCounts,
  runWithConcurrency,
  scanRepoCommits,
} from "./api/bitbucket";
import type {
  AuthConfig,
  ContributionCache,
  ContributionResponse,
  MessageRequest,
  MessageResponse,
} from "./types";
import {
  CACHE_TTL_MS,
  MAX_CONCURRENT_REPOS,
  STORAGE_AUTH_KEY,
  STORAGE_CACHE_KEY,
} from "./types";

async function getAuth(): Promise<AuthConfig | null> {
  const data = await chrome.storage.sync.get(STORAGE_AUTH_KEY);
  const auth = data[STORAGE_AUTH_KEY] as AuthConfig | undefined;
  if (!auth?.email || !auth?.apiToken) return null;
  return auth;
}

async function getCache(accountId: string): Promise<ContributionCache | null> {
  const data = await chrome.storage.local.get(STORAGE_CACHE_KEY);
  const cache = data[STORAGE_CACHE_KEY] as ContributionCache | undefined;
  if (!cache || cache.accountId !== accountId) return null;
  if (Date.now() - cache.fetchedAt > CACHE_TTL_MS) return null;
  return cache;
}

async function saveCache(cache: ContributionCache): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_CACHE_KEY]: cache });
}

async function aggregateContributions(
  auth: AuthConfig,
  onProgress: (
    done: number,
    total: number,
    repoName: string,
    phase: "listing" | "scanning",
  ) => void,
): Promise<Omit<ContributionCache, "fetchedAt">> {
  onProgress(0, 0, "", "listing");
  const user = await fetchCurrentUser(auth);
  const repos = await listMemberRepos(auth);
  const dailyCounts: Record<string, number> = {};
  let totalCommits = 0;
  let partial = false;

  let done = 0;
  const total = repos.length;
  onProgress(0, total, "", "scanning");

  const results = await runWithConcurrency(
    repos,
    MAX_CONCURRENT_REPOS,
    async (repo) => {
      const result = await scanRepoCommits(
        auth,
        repo,
        user.account_id,
        auth.email,
      );
      done += 1;
      onProgress(done, total, repo.name, "scanning");
      return result;
    },
  );

  for (const result of results) {
    mergeDailyCounts(dailyCounts, result.dailyCounts);
    totalCommits += result.commitCount;
    if (result.partial) partial = true;
  }

  return {
    dailyCounts,
    totalCommits,
    repoCount: repos.length,
    partial,
    accountId: user.account_id,
  };
}

function keepServiceWorkerAlive(): () => void {
  const timer = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, 20_000);
  return () => clearInterval(timer);
}

function pushToTab(tabId: number | undefined, message: ContributionResponse): void {
  if (tabId === undefined) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

chrome.runtime.onMessage.addListener(
  (
    request: MessageRequest,
    _sender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    void (async () => {
      try {
        if (request.action === "getUser") {
          const auth = await getAuth();
          if (!auth) {
            sendResponse({ ok: false, error: "Missing API credentials" });
            return;
          }
          const user = await fetchCurrentUser(auth);
          sendResponse({ ok: true, user });
          return;
        }

        if (request.action === "testConnection") {
          const user = await fetchCurrentUser({
            email: request.email,
            apiToken: request.apiToken,
          });
          sendResponse({ ok: true, displayName: user.display_name });
          return;
        }

        if (request.action === "clearCache") {
          await chrome.storage.local.remove(STORAGE_CACHE_KEY);
          sendResponse({ ok: true, cleared: true });
          return;
        }

        if (request.action === "getContributions") {
          const auth = await getAuth();
          if (!auth) {
            sendResponse({
              type: "error",
              message: "Add your Bitbucket email and API token in extension options.",
              needsAuth: true,
            });
            return;
          }

          const user = await fetchCurrentUser(auth);
          const tabId = _sender.tab?.id;

          if (!request.refresh) {
            const cached = await getCache(user.account_id);
            if (cached) {
              sendResponse({
                type: "result",
                dailyCounts: cached.dailyCounts,
                totalCommits: cached.totalCommits,
                repoCount: cached.repoCount,
                partial: cached.partial,
                fromCache: true,
              });
              return;
            }
          }

          sendResponse({ type: "started" });

          const stopKeepAlive = keepServiceWorkerAlive();
          void (async () => {
            try {
              const result = await aggregateContributions(
                auth,
                (done, total, repoName, phase) => {
                  pushToTab(tabId, {
                    type: "progress",
                    done,
                    total,
                    repoName,
                    phase,
                  });
                },
              );

              const cache: ContributionCache = {
                ...result,
                fetchedAt: Date.now(),
              };
              await saveCache(cache);

              pushToTab(tabId, {
                type: "result",
                dailyCounts: result.dailyCounts,
                totalCommits: result.totalCommits,
                repoCount: result.repoCount,
                partial: result.partial,
                fromCache: false,
              });
            } catch (err) {
              const message =
                err instanceof Error
                  ? err.message
                  : "Unknown error fetching contributions";
              pushToTab(tabId, { type: "error", message });
            } finally {
              stopKeepAlive();
            }
          })();
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error fetching contributions";
        sendResponse({ type: "error", message });
      }
    })();

    return true;
  },
);

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    if (!tab.id) return;

    const url = tab.url ?? "";
    if (!url.startsWith("https://bitbucket.org/")) {
      await chrome.tabs.create({ url: "https://bitbucket.org/" });
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: "toggleChart" });
    } catch {
      // Content script may not be ready yet; retry once after a tick.
      await new Promise((r) => setTimeout(r, 100));
      await chrome.tabs.sendMessage(tab.id, { action: "toggleChart" });
    }
  })();
});
