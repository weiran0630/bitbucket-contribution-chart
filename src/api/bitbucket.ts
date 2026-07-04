import type {
  AuthConfig,
  BitbucketCommit,
  BitbucketRepo,
  BitbucketUser,
  BitbucketWorkspaceAccess,
  PaginatedResponse,
} from "../types";
import { DAYS_TO_FETCH, MAX_CONCURRENT_REPOS, MAX_PAGES_PER_REPO } from "../types";

const API_BASE = "https://api.bitbucket.org/2.0";

function authHeader(email: string, token: string): string {
  return `Basic ${btoa(`${email}:${token}`)}`;
}

async function apiFetch<T>(
  url: string,
  auth: AuthConfig,
): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(auth.email, auth.apiToken),
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error("Invalid email or API token. Check extension options.");
    }
    if (res.status === 410) {
      throw new Error(
        "Bitbucket removed this API (CHANGE-2770). Reload the extension — if this persists, recreate your API token with Workspace + Repository read scopes.",
      );
    }
    throw new Error(`Bitbucket API error ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchCurrentUser(auth: AuthConfig): Promise<BitbucketUser> {
  return apiFetch<BitbucketUser>(`${API_BASE}/user`, auth);
}

export async function listUserWorkspaces(auth: AuthConfig): Promise<string[]> {
  const slugs: string[] = [];
  let url: string | undefined = `${API_BASE}/user/workspaces?pagelen=100`;

  while (url) {
    const page: PaginatedResponse<BitbucketWorkspaceAccess> = await apiFetch(
      url,
      auth,
    );
    for (const entry of page.values) {
      if (entry.workspace?.slug) slugs.push(entry.workspace.slug);
    }
    url = page.next;
  }

  return slugs;
}

async function listWorkspaceRepos(
  auth: AuthConfig,
  workspace: string,
): Promise<BitbucketRepo[]> {
  const repos: BitbucketRepo[] = [];
  let url: string | undefined =
    `${API_BASE}/repositories/${encodeURIComponent(workspace)}?role=member&pagelen=100`;

  while (url) {
    const page: PaginatedResponse<BitbucketRepo> = await apiFetch(url, auth);
    repos.push(...page.values);
    url = page.next;
  }

  return repos;
}

export async function listMemberRepos(auth: AuthConfig): Promise<BitbucketRepo[]> {
  const workspaces = await listUserWorkspaces(auth);
  const seen = new Set<string>();
  const repos: BitbucketRepo[] = [];

  await runWithConcurrency(workspaces, MAX_CONCURRENT_REPOS, async (workspace) => {
    const wsRepos = await listWorkspaceRepos(auth, workspace);
    for (const repo of wsRepos) {
      const key = repo.full_name ?? `${workspace}/${repo.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(repo);
    }
  });

  return repos;
}

function toLocalDateKey(isoDate: string): string {
  const d = new Date(isoDate);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cutoffDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() - DAYS_TO_FETCH);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface RepoScanResult {
  dailyCounts: Record<string, number>;
  commitCount: number;
  partial: boolean;
}

export async function scanRepoCommits(
  auth: AuthConfig,
  repo: BitbucketRepo,
  accountId: string,
  userEmail: string,
): Promise<RepoScanResult> {
  const dailyCounts: Record<string, number> = {};
  let commitCount = 0;
  let partial = false;
  const cutoff = cutoffDate();

  const workspace = repoWorkspaceSlug(repo);
  if (!workspace) {
    return { dailyCounts, commitCount: 0, partial: false };
  }
  const fields = encodeURIComponent(
    "values.date,values.author.user.account_id,values.author.raw,next",
  );
  let url: string | undefined =
    `${API_BASE}/repositories/${workspace}/${repo.slug}/commits/?fields=${fields}&pagelen=100`;

  let pages = 0;

  while (url && pages < MAX_PAGES_PER_REPO) {
    const page: PaginatedResponse<BitbucketCommit> = await apiFetch(url, auth);
    pages += 1;

    let allOlder = page.values.length > 0;

    for (const commit of page.values) {
      const commitDate = new Date(commit.date);
      if (commitDate < cutoff) {
        continue;
      }
      allOlder = false;

      const authorId = commit.author.user?.account_id;
      const raw = commit.author.raw ?? "";
      const isAuthor =
        authorId === accountId ||
        (userEmail && raw.toLowerCase().includes(userEmail.toLowerCase()));

      if (!isAuthor) continue;

      const key = toLocalDateKey(commit.date);
      dailyCounts[key] = (dailyCounts[key] ?? 0) + 1;
      commitCount += 1;
    }

    if (allOlder && page.values.length > 0) {
      break;
    }

    url = page.next;
  }

  if (pages >= MAX_PAGES_PER_REPO && url) {
    partial = true;
  }

  return { dailyCounts, commitCount, partial };
}

export function mergeDailyCounts(
  target: Record<string, number>,
  source: Record<string, number>,
): void {
  for (const [day, count] of Object.entries(source)) {
    target[day] = (target[day] ?? 0) + count;
  }
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/$/, "");
  return trimmed || "/";
}

export function profilePathFromUrl(htmlHref: string): string {
  try {
    return normalizePath(new URL(htmlHref).pathname);
  } catch {
    return "";
  }
}

const HIDDEN_PATH_PREFIXES = [
  "/account/signin",
  "/account/login",
  "/oauth",
  "/product/",
  "/features/",
  "/pricing/",
];

export function shouldShowChart(_profilePath = ""): boolean {
  const current = normalizePath(location.pathname);
  return !HIDDEN_PATH_PREFIXES.some((prefix) => current.startsWith(prefix));
}

export function repoWorkspaceSlug(repo: BitbucketRepo): string {
  if (repo.workspace?.slug) return repo.workspace.slug;
  if (repo.full_name) return repo.full_name.split("/")[0] ?? "";
  return "";
}
