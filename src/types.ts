export interface AuthConfig {
  email: string;
  apiToken: string;
}

export interface BitbucketUser {
  account_id: string;
  display_name: string;
  nickname?: string;
  links: {
    html: { href: string };
  };
}

export interface BitbucketWorkspaceAccess {
  workspace: {
    slug: string;
    name?: string;
  };
}

export interface BitbucketRepo {
  workspace?: { slug: string };
  slug: string;
  name: string;
  full_name?: string;
}

export interface BitbucketCommit {
  date: string;
  author: {
    raw?: string;
    user?: { account_id: string };
  };
}

export interface PaginatedResponse<T> {
  values: T[];
  next?: string;
}

export interface ContributionCache {
  fetchedAt: number;
  dailyCounts: Record<string, number>;
  repoCount: number;
  totalCommits: number;
  partial: boolean;
  accountId: string;
}

export interface ContributionStarted {
  type: "started";
}

export interface ContributionProgress {
  type: "progress";
  done: number;
  total: number;
  repoName: string;
  phase?: "listing" | "scanning";
}

export interface ContributionResult {
  type: "result";
  dailyCounts: Record<string, number>;
  totalCommits: number;
  repoCount: number;
  partial: boolean;
  fromCache: boolean;
}

export interface ContributionError {
  type: "error";
  message: string;
  needsAuth?: boolean;
}

export type ContributionResponse =
  | ContributionStarted
  | ContributionProgress
  | ContributionResult
  | ContributionError;

export type MessageRequest =
  | { action: "getUser" }
  | { action: "getContributions"; refresh?: boolean }
  | { action: "testConnection"; email: string; apiToken: string }
  | { action: "clearCache" }
  | { action: "toggleChart" };

export type MessageResponse =
  | { ok: true; user?: BitbucketUser }
  | { ok: true; displayName?: string }
  | { ok: true; cleared?: boolean }
  | ContributionResponse
  | { ok: false; error: string };

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const DAYS_TO_FETCH = 371;
export const MAX_PAGES_PER_REPO = 50;
export const MAX_CONCURRENT_REPOS = 5;
export const STORAGE_AUTH_KEY = "auth";
export const STORAGE_CACHE_KEY = "contributionCache";
