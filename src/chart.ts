const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface HeatmapOptions {
  dailyCounts: Record<string, number>;
  totalCommits: number;
  partial?: boolean;
  fromCache?: boolean;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekSunday(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function buildWeeks(endDate: Date, weekCount = 53): Date[][] {
  const endSunday = startOfWeekSunday(endDate);
  const weeks: Date[][] = [];

  for (let w = weekCount - 1; w >= 0; w--) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(endSunday);
      day.setDate(endSunday.getDate() - w * 7 + d);
      week.push(day);
    }
    weeks.push(week);
  }

  return weeks;
}

function levelForCount(count: number, thresholds: number[]): number {
  if (count <= 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

function computeThresholds(dailyCounts: Record<string, number>): number[] {
  const values = Object.values(dailyCounts).filter((v) => v > 0).sort((a, b) => a - b);
  if (values.length === 0) return [1, 2, 3, 4];

  const q = (p: number) =>
    values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))];

  return [q(0.25), q(0.5), q(0.75), q(1)];
}

function formatTooltip(date: Date, count: number): string {
  const weekday = WEEKDAYS[date.getDay()];
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const noun = count === 1 ? "contribution" : "contributions";
  if (count === 0) {
    return `No contributions on ${weekday}, ${month} ${day}, ${year}`;
  }
  return `${count} ${noun} on ${weekday}, ${month} ${day}, ${year}`;
}

function infobarActions(): string {
  return `
    <div class="bbcc-infobar-actions">
      <button type="button" class="bbcc-refresh" title="Refresh data">Refresh</button>
      <button type="button" class="bbcc-close" title="Hide for this session" aria-label="Close">×</button>
    </div>
  `;
}

function paintGrid(
  grid: HTMLElement,
  tooltip: HTMLElement,
  weeks: Date[][],
  dailyCounts: Record<string, number>,
  thresholds: number[],
  oneYearAgo: Date,
  today: Date,
): void {
  grid.replaceChildren();

  for (const week of weeks) {
    const col = document.createElement("div");
    col.className = "bbcc-week";

    for (const day of week) {
      const inRange = day >= oneYearAgo && day <= today;
      const key = dateKey(day);
      const count = inRange ? (dailyCounts[key] ?? 0) : 0;
      const level = inRange ? levelForCount(count, thresholds) : 0;

      const cell = document.createElement("span");
      cell.className = "bbcc-cell";
      cell.dataset.level = String(level);
      cell.dataset.date = key;
      cell.title = formatTooltip(day, count);
      cell.setAttribute("aria-label", formatTooltip(day, count));

      if (inRange) {
        cell.addEventListener("mouseenter", (e) => {
          tooltip.hidden = false;
          tooltip.textContent = formatTooltip(day, count);
          positionTooltip(tooltip, e);
        });
        cell.addEventListener("mousemove", (e) => positionTooltip(tooltip, e));
        cell.addEventListener("mouseleave", () => {
          tooltip.hidden = true;
        });
      } else {
        cell.classList.add("bbcc-cell--out-of-range");
      }

      col.appendChild(cell);
    }

    grid.appendChild(col);
  }
}

export function renderHeatmap(
  container: HTMLElement,
  options: HeatmapOptions,
): void {
  const { dailyCounts, totalCommits, partial, fromCache } = options;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneYearAgo = new Date(today);
  oneYearAgo.setDate(oneYearAgo.getDate() - 371);

  const weeks = buildWeeks(today);
  const thresholds = computeThresholds(dailyCounts);
  const cacheNote = fromCache ? " · cached" : "";
  const partialNote = partial ? " · partial data" : "";

  container.innerHTML = `
    <div class="bbcc-infobar-row">
      <div class="bbcc-infobar-brand">
        <span class="bbcc-brand-title">Contributions</span>
        <span class="bbcc-brand-stat">${totalCommits.toLocaleString()} in the last year${cacheNote}${partialNote}</span>
      </div>
      <div class="bbcc-chart-wrap">
        <div class="bbcc-grid-area">
          <div class="bbcc-grid" role="img" aria-label="Contribution activity heatmap"></div>
        </div>
        <div class="bbcc-legend" aria-hidden="true">
          <span>Less</span>
          ${[0, 1, 2, 3, 4].map((l) => `<span class="bbcc-cell" data-level="${l}"></span>`).join("")}
          <span>More</span>
        </div>
      </div>
      ${infobarActions()}
    </div>
    <div class="bbcc-tooltip" hidden></div>
  `;

  const grid = container.querySelector<HTMLElement>(".bbcc-grid")!;
  const tooltip = container.querySelector<HTMLElement>(".bbcc-tooltip")!;
  paintGrid(grid, tooltip, weeks, dailyCounts, thresholds, oneYearAgo, today);
}

function positionTooltip(tooltip: HTMLElement, e: MouseEvent): void {
  const offset = 12;
  tooltip.style.left = `${e.clientX + offset}px`;
  tooltip.style.top = `${e.clientY + offset}px`;
}

export function renderLoading(
  container: HTMLElement,
  done: number,
  total: number,
  repoName: string,
  phase: "listing" | "scanning" = "scanning",
): void {
  let statusText: string;
  if (phase === "listing") {
    statusText = "Fetching repository list…";
  } else if (total === 0) {
    statusText = "No repositories found to scan";
  } else {
    statusText = `Scanning ${done} / ${total}${repoName ? ` — ${escapeHtml(repoName)}` : ""}`;
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const indeterminate = phase === "listing" || (total === 0 && phase === "scanning");

  container.innerHTML = `
    <div class="bbcc-infobar-row">
      <div class="bbcc-infobar-brand">
        <span class="bbcc-brand-title">Contributions</span>
        <span class="bbcc-brand-stat">Loading…</span>
      </div>
      <div class="bbcc-loading-body">
        <p class="bbcc-loading-text">${statusText}</p>
        <div class="bbcc-progress-bar${indeterminate ? " bbcc-progress-bar--indeterminate" : ""}" role="progressbar" aria-valuenow="${indeterminate ? 0 : pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="bbcc-progress-fill" style="width: ${indeterminate ? "100%" : `${pct}%`}"></div>
        </div>
      </div>
      ${infobarActions()}
    </div>
  `;
}

export function renderError(
  container: HTMLElement,
  message: string,
  needsAuth?: boolean,
): void {
  const optionsLink = needsAuth
    ? `<a href="#" class="bbcc-options-link">Open options</a>`
    : "";

  container.innerHTML = `
    <div class="bbcc-infobar-row">
      <div class="bbcc-infobar-brand">
        <span class="bbcc-brand-title">Contributions</span>
        <span class="bbcc-brand-stat bbcc-brand-stat--error">Could not load</span>
      </div>
      <div class="bbcc-error-body">
        <p>${escapeHtml(message)}</p>
        ${optionsLink}
        <button type="button" class="bbcc-retry">Try again</button>
      </div>
      ${infobarActions()}
    </div>
  `;
}

export function syncSpacer(): void {
  const widget = document.getElementById("bbcc-contribution-widget");
  const spacer = document.getElementById("bbcc-spacer");
  if (!spacer) return;
  if (!widget || widget.classList.contains("bbcc-hidden")) {
    spacer.style.height = "0px";
    return;
  }
  spacer.style.height = `${widget.offsetHeight}px`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
