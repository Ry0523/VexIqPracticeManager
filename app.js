"use strict";
/**
 * Browser application coordinator for the active game's event and page state.
 * Owns navigation, match drafts, shared page rendering, and cross-workflow
 * coordination. Delegates validation, persistence, history, and specialized
 * practice, Skills, access, and review behavior to their owning modules.
 * Game-specific scoring and presentation come from the active game definition.
 */
const Core = globalThis.EventRules;
const History = globalThis.ScoreHistory;
const Finals = globalThis.FinalsModel;
const Game = globalThis.VexGame;
const ACTIVE_GAME = Game.active;
const MATCH_MS = Core.TIMING.matchMs;
// Storage keys keep their original names so existing saved data is still found after a game change.
const STORAGE_KEY = `${Game.ACTIVE_GAME_ID}-local-event-v1`;
/**
 * Returns the matching page element.
 *
 * @param {string} id - Required element ID from index.html.
 * @returns {HTMLElement}
 */
const get = (id) => document.getElementById(id);
/**
 * Escapes dynamic text before inserting it as HTML.
 *
 * @param {unknown} value - Text to render.
 * @returns {string}
 */
const escapeText = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
/**
 * Returns a new empty event for the active game.
 *
 * @returns {import("./types").EventState}
 */
const emptyState = () => ({
  version: 1,
  game: Game.ACTIVE_GAME_ID,
  sessionId: History.newId(),
  history: [],
  rubrics: [],
  interviews: [],
  robots: [],
  name:
    ACTIVE_GAME.eventName ||
    (ACTIVE_GAME.program === "VEX IQ" ? "Local teamwork" : `${ACTIVE_GAME.name} practice`),
  teams: [],
  matches: [],
  finals: [],
  finalsWithdrawn: [],
  selectedPhase: "qualification",
  skills: [],
  skillsOnly: false,
  rounds: 6,
  start: "09:00",
  interval: 3,
  selected: null,
});
let state = emptyState();
let draft = { counts: Core.emptyCounts(), statuses: {} };
let dirty = false;
let remaining = MATCH_MS;
let deadline = null;
let editingTeam = null;
let rosterSort = null;
let unsaved = false;
let saveRevision = 0;
let storageReady = false;
let analysisTeam = null;
let officialStandings = ACTIVE_GAME.officialStandings || null;
let officialStandingsRequest = 0;
let analysisRobot = "current";
let robotTeam = null;
let editingRobot = null;
let removingRobot = null;
let analysisSort = { field: "rank", direction: "ascending" };

/**
 * Returns whether the game-defined driver-switch interval is active.
 *
 * @param {number} ms - Remaining timer duration.
 * @returns {boolean}
 */
const inSwitchWindow = (ms) =>
  Boolean(
    Core.TIMING.driverSwitch &&
      ms <= Core.TIMING.driverSwitch.openMs &&
      ms >= Core.TIMING.driverSwitch.closeMs,
  );
/**
 * Returns clock display in M:SS format.
 *
 * @param {number} ms - Remaining timer duration.
 * @returns {string}
 */
const clockText = (ms) => {
  const seconds = Math.ceil(Math.min(MATCH_MS, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
/**
 * Returns cSS conic-gradient angle for timer progress.
 *
 * @param {number} ms - Remaining timer duration.
 * @returns {string}
 */
const timerProgressAngle = (ms) =>
  `${(((MATCH_MS - Math.max(0, Math.min(MATCH_MS, ms))) * 360) / MATCH_MS).toFixed(2)}deg`;
/**
 * Returns a game-prefixed export filename.
 *
 * @param {string} suffix - Filename suffix.
 * @returns {string}
 */
const fileName = (suffix) => `${ACTIVE_GAME.id}-${suffix}`;
// Reuse filtered history arrays between renders so ScoreHistory can reuse resolved results.
/**
 * Returns a selector cached by source-array and extra-key identity.
 *
 * @template T
 * @param {(records: import("./types").ScoreHistoryRecord[], extra?: string) => T} filter - History selector.
 * @returns {(records: import("./types").ScoreHistoryRecord[], extra?: string) => T}
 */
const memoByHistory = (filter) => {
  let source, key, value;
  return (records, extra) => {
    if (records !== source || extra !== key) {
      source = records;
      key = extra;
      value = filter(records, extra);
    }
    return value;
  };
};
/**
 * Returns records belonging to the active game, cached until history changes.
 *
 * @param {import("./types").ScoreHistoryRecord[]} records - History records.
 * @returns {import("./types").ScoreHistoryRecord[]}
 */
const seasonFilter = memoByHistory((records) => History.forGame(records));
/**
 * Returns resolved history for the active game.
 *
 * @returns {import("./types").ScoreHistoryRecord[]}
 */
const seasonHistory = () => seasonFilter(state.history);
/**
 * Returns records matching the active source filter, cached by inputs.
 *
 * @param {import("./types").ScoreHistoryRecord[]} records - History records.
 * @param {string} source - Event, practice, or all-records filter.
 * @returns {import("./types").ScoreHistoryRecord[]}
 */
const sourceFilter = memoByHistory((records, source) => History.filterSource(records, source));

let noticeTimer = null;
/**
 * Displays a notice and replaces its dismissal timer.
 *
 * @param {string} message - User-facing status or error text.
 * @returns {void}
 */
function notify(message) {
  get("notice-message").textContent = message;
  get("notice").hidden = false;
  clearTimeout(noticeTimer);
  if (document.body.classList.contains("flow-open"))
    noticeTimer = setTimeout(() => {
      get("notice").hidden = true;
    }, 6000);
}
globalThis.timerAudioError = notify;

// In-app confirmation. Native confirm() inside the Apps Script frame shows "An embedded page at ... says" on Android.
let confirmAnswer = null;
/**
 * Closes the dialog and resolves its pending promise.
 *
 * @param {boolean} value - Whether the in-app confirmation was accepted.
 * @returns {void}
 */
function settleConfirm(value) {
  const resolve = confirmAnswer;
  confirmAnswer = null;
  if (get("confirm-dialog").open) get("confirm-dialog").close();
  resolve?.(value);
}
/**
 * Resolves true on confirmation and false on cancellation.
 *
 * @param {string} message - Confirmation prompt.
 * @param {string} [action="OK"] - Confirm-button label.
 * @param {boolean} [danger=false] - Whether to style the action as destructive.
 * @returns {Promise<boolean>}
 */
function ask(message, action = "OK", danger = false) {
  settleConfirm(false);
  get("confirm-message").textContent = message;
  get("confirm-ok").textContent = action;
  get("confirm-ok").className = danger ? "danger" : "primary";
  get("confirm-dialog").showModal();
  (danger ? get("confirm-cancel") : get("confirm-ok")).focus();
  return new Promise((resolve) => {
    confirmAnswer = resolve;
  });
}
get("confirm-ok").addEventListener("click", () => settleConfirm(true));
get("confirm-cancel").addEventListener("click", () => settleConfirm(false));
get("confirm-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  settleConfirm(false);
});
get("confirm-dialog").addEventListener("close", () => settleConfirm(false));

/**
 * Returns the validated event state; throws when invalid.
 *
 * @param {unknown} candidate - Parsed or loaded event data.
 * @returns {import("./types").EventState}
 */
function validateState(candidate) {
  return globalThis.EventModel.validate(candidate);
}

// When the game flag changes, an event saved under the previous game starts a fresh session for the active game.
/**
 * Returns the rolled-over state and prior game definition when the active game changes.
 *
 * @param {import("./types").EventState} candidate - Loaded event state.
 * @returns {{next: import("./types").EventState, from: import("./types").GameDefinition|null}}
 */
function adoptGame(candidate) {
  const next = globalThis.EventModel.rollover(candidate);
  return { next, from: next === candidate ? null : Game.get(candidate.game) };
}
/**
 * Returns user-facing summary of the season rollover.
 *
 * @param {import("./types").GameDefinition} from - Previous active game.
 * @returns {string}
 */
const rolloverMessage = (from) =>
  [
    `${Game.label(ACTIVE_GAME)} is now active.`,
    `The ${from.name} teams, robot versions, schedule, finals, and skills slots were cleared for the new season;`,
    `posted ${from.name} scores and evaluations stay in score history and backups.`,
  ].join(" ");

// Shared saves that cannot reach the server are retried automatically for a few minutes (see storage.js).
let retrying = false;
globalThis.EventStorage.onretry = (error, delay) => {
  retrying = true;
  get("save-state").textContent = "Retrying save...";
  const seconds = Math.ceil(delay / 1000);
  const retryMessage = [
    `Can't reach the shared Google Sheet right now (${error.message}).`,
    "Your changes are kept on this page and will save automatically;",
    `trying again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
    "Keep this page open.",
  ].join(" ");
  notify(retryMessage);
};
/**
 * Returns whether the save completed successfully.
 *
 * @param {import("./types").EventState} [candidate=state] - State snapshot to persist.
 * @returns {Promise<boolean>}
 */
async function persist(candidate = state) {
  if (globalThis.EventStorage.readOnly) {
    notify(readOnlyMessage());
    return false;
  }
  const revision = ++saveRevision;
  unsaved = true;
  get("save-state").textContent = "Saving...";
  try {
    if (!storageReady) throw new Error("Saved data has not loaded. Reload or export your in-memory backup.");
    await globalThis.EventStorage.save(candidate);
    if (revision === saveRevision) {
      unsaved = false;
      get("save-state").textContent = "";
    }
    if (retrying) {
      retrying = false;
      notify("Connection restored. Your changes are saved.");
    }
    return true;
  } catch (error) {
    retrying = false;
    if (revision === saveRevision) {
      unsaved = true;
      get("save-state").textContent = "Not saved";
    }
    notify(`Save failed: ${error.message}${backupAdvice(" Export a backup before closing this event.")}`);
    if (globalThis.EventStorage.conflicted) {
      document.querySelector("main").inert = true;
      showReload();
      notify(
        globalThis.EventStorage.shared
          ? `Shared save stopped: ${error.message}${backupAdvice(" Export your backup, then")} Use Settings > Reload shared data to fetch the latest event. Your changes have not overwritten another operator's work.`
          : `Save stopped: ${error.message} Export your backup, then use Settings > Reload saved event to load the latest version. Your changes have not overwritten the other tab's work.`,
      );
    }
    return false;
  }
}

/**
 * Returns whether the updated event and history were saved.
 *
 * @param {import("./types").EventState} next - Updated event state.
 * @param {import("./types").HistoryKind} kind - History category.
 * @param {unknown} value - Result snapshot to append.
 * @param {import("./types").HistoryAction} action - Audit action.
 * @returns {Promise<boolean>}
 */
async function saveResultChange(next, kind, value, action) {
  next.history = [...state.history, History.capture(state, kind, value, action)];
  state = next;
  return persist();
}

/**
 * Renders the active game's score history and cumulative-analysis views.
 *
 * @returns {void}
 */
function renderHistory() {
  const practiceOnly = ACTIVE_GAME.practiceOnly;
  const rows = practiceOnly ? state.teams : analysisRanking();
  const view = get("analysis-view");
  [...view.children].forEach((child) => {
    if (
      ["team-analysis", "v5-analysis-controls"].includes(child.id) ||
      child.classList.contains("section-heading")
    )
      return;
    child.hidden = practiceOnly;
  });
  get("v5-analysis-controls").hidden = !practiceOnly;
  get("v5-analysis-empty").hidden = !practiceOnly || rows.length > 0;
  get("analysis-view").querySelector(".section-heading .eyebrow").textContent = practiceOnly
    ? "SAVED PRACTICE / TEAM METRICS"
    : "ALL SAVED SESSIONS / COACHING";
  get("analysis-view").querySelector(".section-heading h2").textContent = practiceOnly
    ? "Team analysis"
    : "Cumulative leaderboard";
  document.querySelector('[data-tab="analysis"]').textContent = practiceOnly
    ? "Analysis"
    : "Cumulative leaderboard";
  if (practiceOnly) {
    const select = get("v5-analysis-team");
    if (!rows.some((team) => team.id === analysisTeam)) analysisTeam = rows[0]?.id || null;
    select.innerHTML =
      rows
        .map(
          (team) =>
            `<option value="${escapeText(team.id)}">${escapeText(team.id)} / ${escapeText(team.name)}</option>`,
        )
        .join("") || '<option value="">No teams registered</option>';
    select.value = analysisTeam || "";
  }
  document
    .querySelectorAll("[data-analysis-sort]")
    .forEach((button) =>
      button
        .closest("th")
        .setAttribute(
          "aria-sort",
          button.dataset.analysisSort === analysisSort.field ? analysisSort.direction : "none",
        ),
    );
  if (!practiceOnly)
    get("analysis-rows").innerHTML =
      sortAnalysis(rows)
        .map((row) => {
          const pointCells = [
            ["skills", "skillsPoints"],
            ["teamwork", "teamworkPoints"],
            ["notebook", "notebookPoints"],
            ["interview", "interviewPoints"],
          ]
            .map(([raw, points]) => `<td>${row[points].toFixed(2)}<small>Raw: ${row[raw]}</small></td>`)
            .join("");
          const completeness = row.missing.length ? escapeText(row.missing.join("; ")) : "Complete";
          return [
            `<tr><td>${row.rank}</td>`,
            `<td><button type="button" class="team-analysis-link" data-analysis-team="${escapeText(row.id)}" aria-label="Analyze ${escapeText(row.id)}">${escapeText(row.id)}</button></td>`,
            `<td>${escapeText(row.name)}</td>`,
            pointCells,
            `<td><strong>${row.total.toFixed(2)}</strong></td>`,
            `<td>${completeness}</td></tr>`,
          ].join("");
        })
        .join("") || '<tr><td colspan="9">No teams registered.</td></tr>';
  renderTeamAnalysis(rows);
  if (practiceOnly) return;
  const records = seasonHistory();
  const sessions = new Set(records.map((record) => record.sessionId)).size;
  const archived = state.history.length - records.length;
  get("history-summary").textContent =
    `${records.length} ${ACTIVE_GAME.name} score history records across ${sessions} ${sessions === 1 ? "session" : "sessions"}${archived ? ` / ${archived} from other games kept in backups` : ""}`;
  get("history-records").innerHTML =
    records
      .slice(-100)
      .reverse()
      .map((record) => {
        const match = record.kind === "teamwork" ? record.value : null;
        const result = match ? match.result : record.value;
        const detail =
          record.source === "practice"
            ? [
                `${record.runRole === "member" ? "Student practice (not ranked)" : "Coach practice"} / ${match ? "Teamwork" : escapeText(result.mode)}`,
                `<small>Run: ${escapeText(History.localDateTime(record.occurredAt))}</small>`,
                escapeText(record.notes),
              ].join("")
            : match
              ? `${matchLabel(match)} / ${match.phase === "finals" ? `Seed ${match.seed}` : `Round ${match.round}`}`
              : `${escapeText(result.mode)} / Attempt ${result.attempt}`;
        const teams = record.teams
          .map((team) => `${escapeText(team.id)} / ${escapeText(team.name)}`)
          .join("<br>");
        const score = match?.phase === "finals" ? Finals.score(match) : Core.score(result.counts);
        return [
          `<tr><td>${escapeText(History.localDateTime(record.recordedAt))}</td>`,
          `<td>${escapeText(record.eventName)}<small>${escapeText(record.sessionId)}</small></td>`,
          `<td>${detail}</td>`,
          `<td>${teams}</td>`,
          `<td>${escapeText(record.action)}</td>`,
          `<td>${score}</td></tr>`,
        ].join("");
      })
      .join("") || '<tr><td colspan="6">No posted scores yet.</td></tr>';
}

const ANALYSIS_TEXT_FIELDS = new Set(["id", "name"]);
/**
 * Returns rows sorted by the selected column and direction.
 *
 * @param {import("./types").CombinedRankingRow[]} rows - Ranking rows to display.
 * @returns {import("./types").CombinedRankingRow[]}
 */
function sortAnalysis(rows) {
  const { field, direction } = analysisSort;
  /**
   * Compares text values using natural, case-insensitive ordering.
   *
   * @param {string} left First value.
   * @param {string} right Second value.
   * @returns {number} Natural ordering result.
   */
  const text = (left, right) => left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
  /**
   * Returns the selected sortable value from a ranking row.
   *
   * @param {import("./types").CombinedRankingRow} row Ranking row.
   * @returns {number|string} Selected sortable value.
   */
  const value = (row) => (field === "missing" ? row.missing.length : row[field]);
  /**
   * Compares two rows by the currently selected analysis field.
   *
   * @param {import("./types").CombinedRankingRow} left First ranking row.
   * @param {import("./types").CombinedRankingRow} right Second ranking row.
   * @returns {number} Ordering result for the selected field.
   */
  const compare = ANALYSIS_TEXT_FIELDS.has(field)
    ? (left, right) => text(left[field], right[field])
    : (left, right) => value(left) - value(right);
  return [...rows].sort(
    (left, right) =>
      compare(left, right) * (direction === "descending" ? -1 : 1) ||
      left.rank - right.rank ||
      text(left.id, right.id),
  );
}

/**
 * Returns active-game history filtered by the analysis source control.
 *
 * @returns {import("./types").ScoreHistoryRecord[]}
 */
function analysisRecords() {
  return sourceFilter(seasonHistory(), get("analysis-source").value);
}
/**
 * Returns a predicate that limits history to each team's current robot.
 *
 * @returns {(record: import("./types").ScoreHistoryRecord, teamId: string) => boolean}
 */
function currentRobotScope() {
  return History.currentRobotOnly(seasonHistory(), state.robots);
}
/**
 * Builds combined Skills, Teamwork, notebook, and interview leaderboard rows.
 *
 * @returns {import("./types").CombinedRankingRow[]}
 */
function analysisRanking() {
  return globalThis.NotebookRubric.combinedRanking(
    analysisRecords(),
    state.teams,
    Game.forGame(state.rubrics),
    Game.forGame(state.interviews),
    currentRobotScope(),
  );
}

/**
 * Rows supported by the standard leaderboard and V5 team-analysis views.
 * @typedef {import("./types").CombinedRankingRow[]|import("./types").Team[]} AnalysisRows
 */
/**
 * Updates the selected team's analysis and leaderboard DOM.
 *
 * @param {AnalysisRows} [rows=analysisRanking()] - Rows for the current analysis view.
 * @returns {void}
 */
function renderTeamAnalysis(rows = analysisRanking()) {
  const team = rows.find((row) => row.id === analysisTeam);
  get("team-analysis").hidden = !team;
  get("v5-match-analysis").hidden = !ACTIVE_GAME.practiceOnly || !team;
  if (!team) {
    analysisTeam = null;
    return;
  }
  get("team-analysis-team-id").hidden = !ACTIVE_GAME.practiceOnly;
  get("team-analysis-team-id").textContent = team.id;
  get("team-profile-row").hidden = !ACTIVE_GAME.teamProfileProgram;
  if (ACTIVE_GAME.teamProfileProgram)
    get("team-profile").href =
      `https://events.vex.com/teams/${encodeURIComponent(ACTIVE_GAME.teamProfileProgram)}/${encodeURIComponent(team.id)}`;
  const standingsSnapshot = officialStandings;
  const officialStanding = standingsSnapshot?.teams?.[team.id.toUpperCase()];
  get("official-standings").hidden = !ACTIVE_GAME.officialStandings || !officialStanding;
  if (officialStanding) {
    get("official-standings-captured").textContent = standingsSnapshot.capturedAt;
    get("official-standings-grade").textContent = officialStanding.gradeLevel;
    get("official-standings-source").href =
      officialStanding.sourceUrl ||
      [
        `${standingsSnapshot.sourceUrl}?search=${encodeURIComponent(team.id)}`,
        `&event_region=&country=${ACTIVE_GAME.officialStandings.countryId}`,
        `&region=${ACTIVE_GAME.officialStandings.regionId}`,
        `&grade_level=${encodeURIComponent(officialStanding.gradeLevel)}`,
      ].join("");
    const standingsCells = [
      officialStanding.row,
      officialStanding.rank,
      officialStanding.score,
      officialStanding.autonomous,
      officialStanding.driver,
      officialStanding.highestAutonomous,
      officialStanding.highestDriver,
    ]
      .map((value) => `<td>${value}</td>`)
      .join("");
    get("official-standings-row").innerHTML = `<tr>${standingsCells}</tr>`;
  }
  get("team-analysis-heading").textContent = ACTIVE_GAME.practiceOnly
    ? team.name
    : `${team.id} / ${team.name}`;
  const versions = History.robotVersions(state.robots, team.id);
  const robotOf = History.robotAttribution(seasonHistory(), state.robots);
  const current = History.currentRobot(state.robots, team.id);
  if (
    analysisRobot !== "current" &&
    analysisRobot !== "all" &&
    analysisRobot !== "original" &&
    !versions.some((robot) => robot.id === analysisRobot)
  )
    analysisRobot = "current";
  get("team-analysis-robot-field").hidden = ACTIVE_GAME.practiceOnly || !versions.length;
  get("team-analysis-robot").innerHTML = [
    ["current", `Current robot (${current ? current.name : "Original robot"})`],
    ["all", "All robots"],
    ["original", "Original robot"],
    ...versions.map((robot) => [
      robot.id,
      `${robot.name} (from ${History.localDate(robot.startedAt)})${robot.abandonedAt !== undefined ? " - abandoned" : ""}`,
    ]),
  ]
    .map(([value, label]) => `<option value="${escapeText(value)}">${escapeText(label)}</option>`)
    .join("");
  get("team-analysis-robot").value = analysisRobot;
  const target =
    analysisRobot === "current" ? (current?.id ?? null) : analysisRobot === "original" ? null : analysisRobot;
  const detail = History.teamAnalysis(
    analysisRecords(),
    team.id,
    ACTIVE_GAME.practiceOnly || analysisRobot === "all"
      ? () => true
      : (record) => robotOf(record, team.id) === target,
  );
  if (ACTIVE_GAME.practiceOnly) {
    const metrics = detail.scrimmage;
    /**
     * Formats a nullable scrimmage metric to two decimal places.
     *
     * @param {number|null} value Metric value.
     * @returns {string} Two-decimal value or placeholder.
     */
    const format = (value) => (Number.isFinite(value) ? value.toFixed(2) : "--");
    const metricCells = [
      metrics.matches,
      `${metrics.wins}-${metrics.ties}-${metrics.losses}`,
      metrics.wp,
      metrics.ap,
      metrics.sp,
      `${format(metrics.scoreFor.best)} / ${format(metrics.scoreFor.average)}`,
      format(metrics.scoreAgainst.average),
      format(metrics.scoreDifferential.average),
      format(metrics.opr),
      format(metrics.dpr),
      format(metrics.ccwm),
    ];
    get("v5-scrimmage-metrics").innerHTML =
      `<tr>${metricCells.map((value) => `<td>${value}</td>`).join("")}</tr>`;
    get("v5-rating-note").hidden = metrics.opr !== null && metrics.dpr !== null && metrics.ccwm !== null;
    get("close-team-analysis").hidden = true;
    get("team-analysis-partners-heading").textContent = "Practice scrimmage partners";
  } else {
    get("close-team-analysis").hidden = false;
    get("team-analysis-partners-heading").textContent = "Teamwork by partner";
  }
  get("team-robot-comparison").hidden = ACTIVE_GAME.practiceOnly || !versions.length;
  get("team-robot-rows").innerHTML = versions.length
    ? History.robotComparison(analysisRecords(), state.robots, team.id)
        .map((row) => {
          const rowClass = row.current ? ' class="current-robot"' : "";
          const robotStatus = row.current
            ? " <small>Current</small>"
            : row.abandonedAt !== undefined
              ? ` <small class="robot-abandoned">Abandoned ${escapeText(History.localDate(row.abandonedAt))}</small>`
              : "";
          const notes = row.notes ? `<small>${escapeText(row.notes)}</small>` : "";
          const startedAt = row.startedAt
            ? escapeText(History.localDateTime(row.startedAt))
            : "Before first version";
          const modes = ["teamwork", "driver", "autonomous"]
            .map(
              (mode) =>
                `<td>${row.modes[mode].count}</td><td>${average(row.modes[mode].best)}</td><td>${average(row.modes[mode].average)}</td>`,
            )
            .join("");
          return [
            `<tr${rowClass}><td>${escapeText(row.name)}${robotStatus}${notes}</td>`,
            `<td>${startedAt}</td>`,
            modes,
            `<td><strong>${row.skillsBest ?? "--"}</strong></td></tr>`,
          ].join("");
        })
        .join("")
    : "";
  const names = {
    teamwork: ACTIVE_GAME.practiceOnly ? "Teamwork scrimmage" : "Teamwork (shared score)",
    driver: "Driver skills",
    autonomous: "Autonomous skills",
  };
  /**
   * Formats a score change for the team analysis summary.
   *
   * @param {number|null} value Change in score.
   * @returns {string} Signed point change or placeholder.
   */
  const improvement = (value) =>
    value === null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)} points`;
  get("team-analysis-summary").innerHTML = Object.entries(detail.modes)
    .map(([mode, stats]) =>
      [
        "<tr><td>",
        names[mode],
        `</td><td>${stats.count}</td>`,
        `<td>${average(stats.recentAverage)}<small>Last ${stats.recentCount} dated runs</small></td>`,
        `<td>${improvement(stats.change)}<small>Compared with preceding ${stats.previousCount} runs</small></td>`,
        `<td>${average(stats.recentBest)}</td>`,
        `<td>${average(stats.best)}<small>${escapeText(stats.bestDate)}</small></td>`,
        `<td>${stats.dq}</td></tr>`,
      ].join(""),
    )
    .join("");
  get("team-analysis-trends").innerHTML = Object.entries(detail.modes)
    .map(([mode, stats]) => {
      const entries = stats.rolling.slice(-30);
      const max = Math.max(1, ...entries.flatMap((entry) => [entry.score, entry.rollingAverage]));
      const points = entries.map((entry, index) => ({
        x: entries.length === 1 ? 300 : 25 + (index * 550) / (entries.length - 1),
        y: 145 - (entry.score * 120) / max,
        entry,
      }));
      const scorePointMarkup = points
        .map((point) => {
          const rollingY = 145 - (point.entry.rollingAverage * 120) / max;
          const pointDescription = [
            escapeText(History.localDateTime(point.entry.recordedAt)),
            escapeText(point.entry.label),
            `${point.entry.score} points`,
            escapeText(point.entry.status),
            `Last ${point.entry.rollingCount} average: ${average(point.entry.rollingAverage)}`,
          ].join(" / ");
          const averageDescription = `Last ${point.entry.rollingCount} average: ${average(point.entry.rollingAverage)}`;
          return [
            `<circle cx="${point.x}" cy="${point.y}" r="4" fill="currentColor">`,
            `<title>${pointDescription}</title></circle>`,
            `<circle cx="${point.x}" cy="${rollingY}" r="3" fill="var(--paper)" stroke="currentColor">`,
            `<title>${averageDescription}</title></circle>`,
          ].join("");
        })
        .join("");
      const chart = entries.length
        ? [
            `<svg class="analysis-trend-chart" viewBox="0 0 600 170" role="img" aria-label="${names[mode]} scores and rolling five-run average; latest ${entries.length} dated results">`,
            `<title>${names[mode]}: individual scores and rolling five-run average</title>`,
            '<path d="M25 25V145H575" fill="none" stroke="currentColor"/>',
            `<polyline points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="1" opacity="0.35"/>`,
            `<polyline class="rolling-average" points="${points.map((point) => `${point.x},${145 - (point.entry.rollingAverage * 120) / max}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="3"/>`,
            scorePointMarkup,
            `<text x="0" y="20">${max}</text>`,
            '<text x="2" y="149">0</text>',
            '<text x="25" y="165">Earlier</text>',
            '<text x="530" y="165">Latest</text>',
            "</svg>",
          ].join("")
        : "<p>No dated results yet.</p>";
      return [
        `<section class="team-trend"><h4>${names[mode]}</h4>`,
        "<p>",
        [
          `Current level (last ${stats.recentCount}): ${average(stats.recentAverage)}`,
          `Previous ${stats.previousCount}: ${average(stats.previousAverage)}`,
          `Improvement: ${improvement(stats.change)}`,
          `Recent best: ${average(stats.recentBest)}`,
          `Unknown dates: ${stats.unknownDates}`,
        ].join(" / "),
        "</p>",
        '<p class="rules-note">Filled dots and thin line: individual scores. Hollow dots and thick line: rolling five-run average.</p>',
        chart,
        "</section>",
      ].join("");
    })
    .join("");
  get("team-analysis-partners").innerHTML =
    detail.partners
      .map((partner) =>
        [
          `<tr><td>${escapeText(partner.id)} / ${escapeText(partner.name)}</td>`,
          `<td>${partner.count}</td>`,
          `<td>${average(partner.best)}</td>`,
          `<td>${average(partner.average)}</td>`,
          `<td>${average(partner.fieldBest)}</td>`,
          `<td>${average(partner.fieldAverage)}</td>`,
          `<td>${partner.dq}</td></tr>`,
        ].join(""),
      )
      .join("") || '<tr><td colspan="7">No teamwork results for this team.</td></tr>';
  get("team-analysis-sessions").innerHTML =
    Object.entries(detail.modes)
      .flatMap(([mode, stats]) => {
        const sessions = new Map();
        for (const entry of stats.entries) {
          if (!sessions.has(entry.sessionId)) {
            const practice = entry.sessionId.startsWith("practice:");
            sessions.set(entry.sessionId, {
              name: practice ? `Practice / ${History.localDateTime(entry.recordedAt)}` : entry.eventName,
              id: practice ? "" : entry.sessionId,
              values: [],
            });
          }
          sessions.get(entry.sessionId).values.push(entry.score);
        }
        return [...sessions].map(([id, session]) => {
          const summary = History.statistics(session.values);
          return [
            `<tr><td>${escapeText(session.name)}${session.id ? `<small>${escapeText(session.id)}</small>` : ""}</td>`,
            `<td>${names[mode]}</td>`,
            `<td>${summary.count}</td>`,
            `<td>${average(summary.best)}</td>`,
            `<td>${average(summary.average)}</td></tr>`,
          ].join("");
        });
      })
      .join("") || '<tr><td colspan="5">No results for this team.</td></tr>';
}

/**
 * Refreshes configured official Skills standings and rerenders analysis when current.
 *
 * @returns {Promise<void>}
 */
async function refreshOfficialStandings() {
  const load = globalThis.EventStorage.loadOfficialSkillsStandings;
  if (!ACTIVE_GAME.officialStandings || typeof load !== "function") return;
  const request = ++officialStandingsRequest;
  get("official-standings-status").textContent = "Refreshing official standings...";
  try {
    const snapshot = await load.call(globalThis.EventStorage);
    if (request !== officialStandingsRequest) return;
    if (!snapshot?.capturedAt || !snapshot.teams || typeof snapshot.teams !== "object")
      throw new Error("Invalid standings response.");
    officialStandings = snapshot;
    get("official-standings-status").textContent =
      `Updated from VEX at ${History.localDateTime(snapshot.capturedAt)}.`;
    renderTeamAnalysis(ACTIVE_GAME.practiceOnly ? state.teams : analysisRanking());
  } catch (error) {
    if (request !== officialStandingsRequest) return;
    const fallback = officialStandings?.capturedAt
      ? `Showing the saved snapshot from ${officialStandings.capturedAt}.`
      : "No saved standings are available.";
    get("official-standings-status").textContent = `Live refresh failed. ${fallback}`;
  }
}

/**
 * Returns matches in the selected qualification or finals phase.
 *
 * @returns {Array<import("./types").Match|import("./types").FinalsMatch>}
 */
function activeMatches() {
  return state.selectedPhase === "finals" ? state.finals : state.matches;
}
/**
 * Returns currently selected match, if one exists.
 *
 * @returns {import("./types").Match|import("./types").FinalsMatch|undefined}
 */
function currentMatch() {
  return activeMatches().find((match) => match.id === state.selected);
}
/**
 * Returns compact qualification, finals, or tiebreaker identifier.
 *
 * @param {import("./types").Match|import("./types").FinalsMatch} match - Match to label.
 * @returns {string}
 */
function matchLabel(match) {
  return `${match.phase === "finals" ? "F" : "Q"}${match.id}${match.phase === "finals" && match.round > 1 ? ` / TB${match.round - 1}` : ""}`;
}
/**
 * Returns whether existing finals lock qualification results. Also notifies the operator when locked.
 *
 * @returns {boolean}
 */
function qualificationLocked() {
  if (state.selectedPhase === "qualification" && state.finals.length) {
    notify(
      "Finals alliances have been formed. Discard unplayed finals or end the event before changing qualification scores.",
    );
    return true;
  }
  return false;
}
/**
 * Clears a stale finals Stop Time when starting a new timed run.
 *
 * @returns {void}
 */
function clearFinalsStopTime() {
  if (currentMatch()?.phase !== "finals") return;
  if (get("finals-stop-time").value !== "0") dirty = true;
  get("finals-stop-time").value = 0;
}
/**
 * Looks up a registered team name, falling back to the ID when unknown.
 *
 * @param {string} id - Team number.
 * @returns {string}
 */
function teamName(id) {
  return state.teams.find((team) => team.id === id)?.name || id;
}
/**
 * Formats an average to two decimals, or returns the empty-state marker.
 *
 * @param {number|null} value - Numeric average.
 * @returns {string}
 */
function average(value) {
  return value === null ? "--" : value.toFixed(2);
}
/**
 * Returns scheduled local time, including a day offset when needed.
 *
 * @param {import("./types").Match} match - Qualification match to time.
 * @returns {string}
 */
function matchTime(match) {
  const [hours, minutes] = state.start.split(":").map(Number);
  const total = hours * 60 + minutes + (match.id - 1) * state.interval;
  const hour = Math.floor(total / 60) % 24;
  return `${hour % 12 || 12}:${String(total % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}${total >= 1440 ? ` (+${Math.floor(total / 1440)}d)` : ""}`;
}
/**
 * Returns whether all pending score, practice, Skills, and review edits may be discarded.
 *
 * @returns {Promise<boolean>}
 */
async function discardDraft() {
  if (
    !dirty &&
    !globalThis.SkillsUI?.isDirty() &&
    !globalThis.PracticeUI?.isDirty() &&
    !globalThis.RubricUI?.isDirty() &&
    !globalThis.InterviewUI?.isDirty()
  )
    return true;
  if (!(await ask("Discard the unposted score or unsaved evaluation changes?", "Discard changes", true)))
    return false;
  globalThis.SkillsUI?.discard();
  globalThis.PracticeUI?.reset();
  globalThis.RubricUI?.reset();
  globalThis.InterviewUI?.reset();
  return true;
}
/**
 * Returns whether no timer is starting/running; shows a notice when an operation must wait.
 *
 * @returns {boolean}
 */
function idle() {
  if (globalThis.TimerAudio.isStarting()) {
    notify("Wait for the timer audio to become ready.");
    return false;
  }
  if (deadline !== null || globalThis.SkillsUI?.isRunning() || globalThis.PracticeUI?.isRunning()) {
    notify("Stop or pause the running match or practice run first.");
    return false;
  }
  return true;
}
let currentTab = "setup";
let screenWakeLock = null;
let screenWakePending = false;
let screenWakeWanted = false;
/**
 * Acquires or releases the screen wake lock for active work.
 *
 * @param {boolean} [force=false] - Recheck even when the desired lock state has not changed.
 * @returns {void}
 */
function syncScreenWakeLock(force = false) {
  const wanted =
    !document.hidden &&
    (document.fullscreenElement ||
      document.body.classList.contains("flow-open") ||
      deadline !== null ||
      globalThis.SkillsUI?.isRunning() ||
      globalThis.PracticeUI?.isRunning() ||
      globalThis.TimerAudio.isStarting());
  if (!force && Boolean(wanted) === screenWakeWanted) return;
  screenWakeWanted = Boolean(wanted);
  if (!screenWakeWanted) {
    const lock = screenWakeLock;
    screenWakeLock = null;
    if (lock) lock.release().catch(() => {});
    return;
  }
  if (screenWakeLock || screenWakePending || !navigator.wakeLock?.request) return;
  screenWakePending = true;
  try {
    Promise.resolve(navigator.wakeLock.request("screen"))
      .then((lock) => {
        if (!screenWakeWanted || document.hidden) {
          lock.release().catch(() => {});
          return;
        }
        screenWakeLock = lock;
        lock.addEventListener("release", () => {
          if (screenWakeLock === lock) screenWakeLock = null;
        });
      })
      .catch(() => {})
      .finally(() => {
        screenWakePending = false;
      });
  } catch {
    screenWakePending = false;
  }
}
document.addEventListener("visibilitychange", () => syncScreenWakeLock(true));
document.addEventListener("fullscreenchange", () => syncScreenWakeLock());
const hostedHistory = globalThis.google?.script?.history;
/**
 * Returns tabs currently available to the signed-in role and active game.
 *
 * @returns {Set<string>}
 */
const tabNames = () =>
  new Set(
    [...document.querySelectorAll("[data-tab]")]
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.tab)
      .concat(
        accessRole() === "coach" && !ACTIVE_GAME.practiceOnly ? "history" : [],
        canManageAccess() ? "access" : [],
      ),
  );
// Shared-app roles come from the server: coaches see everything; team members save new practice runs and read reviews
// and submit student reviews, but do not see setup, match control, skills scoring, or score history; viewers get a results-only view with no
// printing, exports, settings, or score history, and see the schedule only once one exists.
// The server enforces the same rules on every save.
const VIEWER_TABS = new Set(["control", "rankings", "skills-rankings", "analysis"]);
const PRACTICE_ONLY_VIEWER_TABS = new Set(["practice", "rubric", "interview"]);
const MEMBER_HIDDEN_TABS = new Set(["setup", "control", "skills"]);
const PRACTICE_ONLY_HIDDEN_TABS = new Set(["control", "rankings", "skills", "skills-rankings"]);
/**
 * Effective role, defaulting to coach in local mode.
 *
 * @returns {"coach"|"member"|"viewer"}
 */
const accessRole = () =>
  globalThis.EventStorage.access?.role || (globalThis.EventStorage.readOnly ? "viewer" : "coach");
/**
 * Returns whether the current shared-app role is team member.
 *
 * @returns {boolean}
 */
const isMember = () => accessRole() === "member";
// Coaches open the access list from Settings; it exists only in the shared app.
/**
 * Returns whether the current coach can manage shared-app access.
 *
 * @returns {boolean}
 */
const canManageAccess = () => accessRole() === "coach" && Boolean(globalThis.EventStorage.shared);
/**
 * Returns whether this owner can open the unsaved student-role preview.
 *
 * @returns {boolean}
 */
const canPreviewStudent = () =>
  !ACTIVE_GAME.practiceOnly &&
  globalThis.EventStorage.shared &&
  globalThis.EventStorage.access?.isOwner === true &&
  !globalThis.EventStorage.previewing;
/**
 * Returns whether qualification or finals matches exist.
 *
 * @returns {boolean}
 */
const hasSchedule = () => state.matches.length > 0 || state.finals.length > 0;
/**
 * Returns initial tab appropriate to the active game, event, and visitor role.
 *
 * @returns {string}
 */
const defaultTab = () =>
  ACTIVE_GAME.practiceOnly
    ? state.teams.length
      ? "practice"
      : "setup"
    : activeMatches().length && tabNames().has("control")
      ? "control"
      : { viewer: "rankings", member: "practice" }[accessRole()] || "setup";
/**
 * Returns role-specific explanation of why the current visitor cannot edit.
 *
 * @returns {string}
 */
function readOnlyMessage() {
  const { email = "", domain = "" } = globalThis.EventStorage.access || {};
  const account = domain ? `a ${domain} Google account` : "a district Google account";
  return email
    ? `${email} can view results only. To score, ask a coach to add your account under Settings > Manage access.`
    : `You're viewing results only. To score, sign in with ${account} that a coach has added to the app's access list.`;
}
/**
 * Updates owner-only student-preview controls and banner state.
 *
 * @returns {void}
 */
function renderStudentPreviewControls() {
  const previewing = Boolean(globalThis.EventStorage.previewing);
  const section = get("settings-student-preview");
  section.hidden = !canPreviewStudent() || previewing;
  const select = get("preview-student-team");
  const previous = select.value;
  select.innerHTML =
    state.teams
      .map(
        (team) =>
          `<option value="${escapeText(team.id)}">${escapeText(team.id)} / ${escapeText(team.name)}</option>`,
      )
      .join("") || '<option value="">Add teams first</option>';
  if (state.teams.some((team) => team.id === previous)) select.value = previous;
  get("preview-student-view").disabled = previewing || !state.teams.length;
  get("student-preview-banner").hidden = !previewing;
  get("student-preview-label").textContent = previewing
    ? `Student view preview / Team ${globalThis.EventStorage.access?.team || ""} / changes are not saved`
    : "";
}
/**
 * Applies role/game visibility, rerenders protected views, and selects an allowed tab.
 *
 * @returns {void}
 */
function applyAccess() {
  const role = accessRole();
  const viewerTabs = ACTIVE_GAME.practiceOnly ? PRACTICE_ONLY_VIEWER_TABS : VIEWER_TABS;
  document.body.classList.toggle("read-only", role === "viewer");
  document.body.classList.toggle("member", role === "member");
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const name = button.dataset.tab;
    button.hidden =
      (ACTIVE_GAME.practiceOnly && PRACTICE_ONLY_HIDDEN_TABS.has(name)) ||
      (role === "viewer"
        ? !viewerTabs.has(name) || (name === "control" && !hasSchedule())
        : role === "member" && MEMBER_HIDDEN_TABS.has(name));
  });
  document.querySelector('[data-tab="control"]').textContent =
    role === "viewer" ? "Schedule" : "Match control";
  get("open-history").closest(".footer-history").hidden = role !== "coach" || ACTIVE_GAME.practiceOnly;
  get("settings-access").hidden = !canManageAccess();
  renderStudentPreviewControls();
  updateEventData();
  globalThis.RubricUI?.render();
  globalThis.InterviewUI?.render();
  if (!tabNames().has(currentTab)) tab(defaultTab(), false);
}
let guardArmed = false;
/**
 * Writes the tab state through Apps Script history or browser history.
 *
 * @param {Record<string, unknown>} entry - Browser navigation state.
 * @param {boolean} [replace=false] - Replace the current history entry instead of pushing.
 * @returns {void}
 */
function writeHistory(state, replace = false) {
  if (hostedHistory) {
    if (replace) hostedHistory.replace(state, {}, state.tab);
    else hostedHistory.push(state, {}, state.tab);
  } else history[replace ? "replaceState" : "pushState"](state, "", `#${state.tab}`);
}
/**
 * Arms the leave guard if needed and records navigation.
 *
 * @param {string} name - Tab identifier.
 * @param {boolean} [replace=false] - Replace rather than push the history entry.
 * @returns {void}
 */
function recordTab(name, replace = false) {
  if (!replace && !guardArmed) armGuard();
  writeHistory({ tab: name }, replace);
}
// The landing history entry is a "guard": Back from the first real entry lands on it and asks before leaving.
// Browsers skip entries added without a user gesture, so the first real entry is pushed on the first interaction.
/**
 * Adds a navigation-history entry that intercepts Back from the app.
 *
 * @returns {void}
 */
function armGuard() {
  if (guardArmed || !storageReady) return;
  guardArmed = true;
  writeHistory({ tab: currentTab });
}
["pointerdown", "keydown"].forEach((type) =>
  addEventListener(
    type,
    (event) => {
      if (event.isTrusted) armGuard();
    },
    { capture: true },
  ),
);
/**
 * Replaces the landing history entry with the app's leave-guard entry.
 *
 * @returns {void}
 */
function setupHistory() {
  writeHistory({ tab: currentTab, guard: true }, true);
}
let leaving = false;
/**
 * Prompts before leaving when navigation reaches the app's history guard.
 *
 * @returns {void}
 */
function confirmLeave() {
  if (document.querySelector(".field-control.flow-mode")) exitFlow();
  globalThis.PracticeUI?.exitFlow();
  document.querySelectorAll("dialog[open]").forEach((dialog) => {
    if (dialog.id !== "leave-dialog") dialog.close();
  });
  const scores = dirty || globalThis.SkillsUI?.isDirty() || globalThis.PracticeUI?.isDirty();
  const evaluations = globalThis.RubricUI?.isDirty() || globalThis.InterviewUI?.isDirty();
  const lost = [
    scores && "unposted score changes",
    evaluations && "unsaved notebook or interview changes",
    unsaved && "changes that are still saving",
  ].filter(Boolean);
  get("leave-dialog-message").textContent = lost.length
    ? `Going back will leave this app. You have ${lost.join(" and ")} that will be lost.`
    : "You're at the start of your navigation history. Going back will leave this app.";
  if (!get("leave-dialog").open) get("leave-dialog").showModal();
}
/**
 * Closes the leave prompt and restores an in-app history entry.
 *
 * @returns {void}
 */
function stayInApp() {
  get("leave-dialog").close();
  guardArmed = true;
  writeHistory({ tab: currentTab });
}
get("stay-in-app").addEventListener("click", stayInApp);
get("leave-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  stayInApp();
});
get("leave-dialog").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    stayInApp();
  }
});
get("leave-app").addEventListener("click", () => {
  leaving = true;
  get("leave-dialog").close();
  history.back();
});
// Back/Forward return to the previous tab instead of leaving the app.
/**
 * Navigates to an allowed tab after closing transient flows/dialogs.
 *
 * @param {string} name - Requested tab identifier.
 * @returns {void}
 */
function navigateTo(name) {
  if (!tabNames().has(name)) name = defaultTab();
  if (name === currentTab) return;
  if (document.querySelector(".field-control.flow-mode")) exitFlow();
  globalThis.PracticeUI?.exitFlow();
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  tab(name, false);
}
/**
 * Routes Back/Forward changes to a tab or leave confirmation.
 *
 * @param {Record<string, unknown>|null} state - Browser history state.
 * @param {string} hash - Location hash supplied by the history adapter.
 * @returns {void}
 */
function historyChanged(state, hash) {
  if (leaving) return;
  if (state?.guard) {
    if (state.tab && state.tab !== currentTab) navigateTo(state.tab);
    confirmLeave();
    return;
  }
  if (get("leave-dialog").open) get("leave-dialog").close();
  navigateTo(state?.tab || hash);
}
if (hostedHistory)
  hostedHistory.setChangeHandler((event) => historyChanged(event.state, event.location?.hash || ""));
else
  addEventListener("popstate", (event) =>
    historyChanged(event.state, decodeURIComponent(location.hash.slice(1))),
  );
/**
 * Shows the view, updates navigation state, and opens tab-specific data.
 *
 * @param {string} name - Allowed tab identifier.
 * @param {boolean} [record=true] - Whether to append browser history.
 * @returns {void}
 */
function tab(name, record = true) {
  const changed = name !== currentTab;
  currentTab = name;
  if (record && changed && storageReady) recordTab(name);
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== `${name}-view`;
  });
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    if (active) {
      const nav = button.parentElement;
      if (nav.scrollWidth > nav.clientWidth)
        nav.scrollLeft = button.offsetLeft - nav.offsetLeft - (nav.clientWidth - button.offsetWidth) / 2;
    }
  });
  if (name === "analysis" && ACTIVE_GAME.officialStandings) refreshOfficialStandings();
  if (name === "access") globalThis.AccessUI?.open();
  if (name === "history") get("open-history").setAttribute("aria-current", "page");
  else get("open-history").removeAttribute("aria-current");
}

/**
 * Renders storage/access status and active-game history count in the footer.
 *
 * @returns {void}
 */
function renderFooter() {
  const member = globalThis.EventStorage?.shared && globalThis.EventStorage.access?.role === "member";
  get("footer-storage").textContent = globalThis.EventStorage?.readOnly
    ? "Read-only results from the shared Google Sheet"
    : member
      ? `Team ${globalThis.EventStorage.access.team} member / scores saved to the shared Google Sheet`
      : globalThis.EventStorage?.shared
        ? "Saved to the shared Google Sheet"
        : "Saved on this device";
  const associatedTeam = globalThis.EventStorage?.access?.team || "";
  const team = state.teams.find((entry) => entry.id === associatedTeam);
  const teamIndicator = get("associated-team");
  teamIndicator.textContent = associatedTeam
    ? `Your team: ${associatedTeam}${team ? ` / ${team.name}` : ""}`
    : "";
  teamIndicator.hidden = !associatedTeam;
  const scores = History.forGame(History.resolve(state.history)).length;
  get("footer-history-count").textContent =
    `/ ${scores.toLocaleString()} ${scores === 1 ? "score" : "scores"} saved`;
}

/**
 * Renders shared event state and delegates specialized views to their UI modules.
 *
 * @returns {void}
 */
function render() {
  const locked = state.matches.length > 0 || state.skills.length > 0;
  const scheduleLocked = state.matches.length > 0;
  get("team-count").textContent = state.teams.length;
  renderFooter();
  get("roster-lock").textContent = locked ? "Scheduled roster / edits available" : "Team directory";
  get("roster-empty").hidden = state.teams.length > 0;
  get("roster").innerHTML = state.teams
    .map((team, index) => {
      const id = escapeText(team.id);
      const actions = [
        '<div class="roster-actions">',
        `<button class="roster-move" data-move="${id}" data-direction="-1" aria-label="Move ${id} up" title="Move team up" ${index === 0 ? "disabled" : ""}>&#8593;</button>`,
        `<button class="roster-move" data-move="${id}" data-direction="1" aria-label="Move ${id} down" title="Move team down" ${index === state.teams.length - 1 ? "disabled" : ""}>&#8595;</button>`,
        `<button data-robots="${id}" aria-label="Robot versions for ${id}" title="Mark a new robot or review robot versions">Robots</button>`,
        `<button data-edit="${id}" aria-label="Edit ${id}">Edit</button>`,
        `<button data-remove="${id}" aria-label="Remove ${id}" title="${locked ? "End event before removing teams" : "Remove team"}" ${locked ? "disabled" : ""}>&times;</button>`,
        "</div>",
      ].join("");
      return [
        `<tr><td>${id}</td>`,
        `<td>${escapeText(team.name)}${robotLabel(team.id)}</td>`,
        `<td>${actions}</td></tr>`,
      ].join("");
    })
    .join("");
  [...get("roster").rows].forEach((row, index) => {
    const team = state.teams[index];
    const cell = row.insertCell(2);
    cell.innerHTML = [
      `<input type="checkbox" data-schedule-team="${escapeText(team.id)}"`,
      ` aria-label="Include ${escapeText(team.id)} in schedule"`,
      ` ${team.includeInSchedule !== false ? "checked" : ""}`,
      ` ${scheduleLocked ? "disabled" : ""}`,
      ` title="${scheduleLocked ? "End event to change schedule inclusion" : "Include this team in generated teamwork matches"}">`,
    ].join("");
  });
  document.querySelectorAll("[data-roster-sort]").forEach((button) => {
    button.disabled = state.teams.length < 2;
    button
      .closest("th")
      .setAttribute(
        "aria-sort",
        rosterSort?.field === button.dataset.rosterSort ? rosterSort.direction : "none",
      );
  });
  get("team-form")
    .querySelectorAll("input,button")
    .forEach((input) => {
      input.disabled = locked && editingTeam === null;
    });
  get("save-team").textContent = editingTeam === null ? "Add team" : "Save team";
  get("cancel-team-edit").hidden = editingTeam === null;
  ["rounds", "start-time", "interval", "generate"].forEach((id) => {
    get(id).disabled = scheduleLocked;
  });
  get("generate").hidden = scheduleLocked;
  get("clear-schedule").hidden = !locked;
  get("rounds").value = state.rounds;
  get("start-time").value = state.start;
  get("interval").value = state.interval;
  updateEstimate();
  get("match-list").innerHTML =
    matchChoices(state.matches) || '<p class="empty">No qualification matches scheduled.</p>';
  get("match-empty").hidden = Boolean(currentMatch());
  get("match-workspace").hidden = !currentMatch();
  if (!ACTIVE_GAME.practiceOnly) {
    renderStandings();
    renderFinals();
  }
  renderHistory();
  globalThis.SkillsUI?.render();
  globalThis.PracticeUI?.render();
  globalThis.RubricUI?.render();
  globalThis.InterviewUI?.render();
}

/**
 * Renders finals readiness, bracket status, rankings, and withdrawal controls.
 *
 * @returns {void}
 */
function renderFinals() {
  const status = Finals.outcome(state.finals);
  const qualified = Finals.eligible(state.teams, state.matches).length;
  const ready = state.matches.length > 0 && state.matches.every((match) => match.result);
  const started = state.history.some(
    (record) => record.sessionId === state.sessionId && record.value.phase === "finals",
  );
  get("generate-finals").hidden = Boolean(state.finals.length) || !state.matches.length;
  get("generate-finals").disabled = !ready || qualified < 2;
  get("finals-readiness").hidden = Boolean(state.finals.length) || !state.matches.length;
  get("finals-readiness").textContent = !ready
    ? "Enter scores for all regular matches before you make finals."
    : qualified < 2
      ? "You need at least 2 teams to make finals."
      : `${qualified} teams are ready for finals.`;
  get("finals-team-count").max = Math.max(2, qualified - (qualified % 2));
  get("finals-count-help").textContent =
    `Choose an even number from 2 to ${Math.max(2, qualified - (qualified % 2))}. ${qualified} teams are available.`;
  get("finals-section").hidden = !state.finals.length;
  get("clear-finals").hidden = !state.finals.length || started;
  get("generate-tiebreaker").hidden = !status.nextRound;
  get("generate-tiebreaker").textContent = `Generate tiebreaker series ${(status.nextRound || 2) - 1}`;
  get("void-tiebreaker").hidden = !state.finals.some((match) => match.round > 1);
  const message = !state.finals.length
    ? "No finals scheduled."
    : status.complete
      ? `Teamwork champions: seed ${status.champion} (${status.rows[0].teams.join(" + ")}).`
      : status.nextRound
        ? `First-place tie: seeds ${status.pending.join(", ")}. Generate tiebreaker series ${status.nextRound - 1}.`
        : "Provisional standings. Complete all scheduled finals matches.";
  get("finals-status").textContent = message;
  get("finals-ranking-status").textContent = message;
  get("finals-rankings").hidden = !state.finals.length;
  /**
   * Renders the teams in one ranked finals alliance.
   *
   * @param {import("./types").FinalsOutcomeRow} row Ranked finals alliance.
   * @returns {string} Escaped alliance teams and names.
   */
  const alliance = (row) =>
    row.teams.map((id) => `${escapeText(id)} / ${escapeText(teamName(id))}`).join("<br>");
  /**
   * Renders a tiebreaker score and Stop Time when the match has been played.
   *
   * @param {import("./types").FinalsMatch|null|undefined} match Tiebreaker match, if scheduled.
   * @returns {string} Score and Stop Time or placeholder.
   */
  const tieScore = (match) => (match?.result ? `${Finals.score(match)} / ${match.result.stopTime}s` : "--");
  get("finals-ranking-rows").innerHTML = status.rows
    .map((row) => {
      const firstTiebreaker = tieScore(row.matches.find((match) => match.round === 2));
      const secondTiebreaker = tieScore(row.matches.find((match) => match.round === 3));
      return [
        `<tr><td>${row.rank ?? "--"}</td><td>${row.seed}</td>`,
        `<td>${alliance(row)}</td><td>${row.score ?? "--"}</td>`,
        `<td>${firstTiebreaker}</td><td>${secondTiebreaker}</td></tr>`,
      ].join("");
    })
    .join("");
  get("finals-match-list").innerHTML = matchChoices(state.finals);
  const withdrawable = state.finals.some((match) => match.round > 1)
    ? []
    : state.finals
        .filter((match) => !state.finals.some((item) => item.seed === match.seed && item.result))
        .flatMap((match) => match.teams);
  get("finals-withdraw").hidden = !withdrawable.length;
  get("finals-withdrawals").innerHTML = withdrawable
    .map(
      (id) =>
        `<button type="button" class="danger" data-withdraw-final="${escapeText(id)}">Withdraw ${escapeText(id)}</button>`,
    )
    .join("");
}

/**
 * Builds button markup for the supplied matches.
 *
 * @param {Array<import("./types").Match|import("./types").FinalsMatch>} matches - Matches to display.
 * @returns {string}
 */
function matchChoices(matches) {
  return matches
    .map((match) => {
      const active =
        (match.phase === "finals") === (state.selectedPhase === "finals") && match.id === state.selected;
      const phaseLabel =
        match.phase === "finals"
          ? `SEED ${match.seed}`
          : `ROUND ${match.round}<time>${matchTime(match)}</time>`;
      const teamLabels = match.teams
        .map((id) => `${escapeText(id)}${match.surrogate === id ? "*" : ""}`)
        .join(" + ");
      const score = match.result
        ? `<em>${match.phase === "finals" ? Finals.score(match) : Core.score(match.result.counts)} pts</em>`
        : "";
      return [
        `<button class="match-choice ${active ? "active" : ""}" data-match="${match.id}"`,
        ` data-phase="${match.phase === "finals" ? "finals" : "qualification"}" aria-pressed="${active}">`,
        `<span>${matchLabel(match)} / ${phaseLabel}</span>`,
        `<b>${teamLabels}</b>${score}</button>`,
      ].join("");
    })
    .join("");
}
/**
 * Renders current qualification standings and all-time Teamwork rankings.
 *
 * @returns {void}
 */
function renderStandings() {
  get("qualification-rankings").hidden = state.matches.length === 0;
  const seasonRecords = seasonHistory();
  const allTime = History.teamworkRanking(
    seasonRecords,
    state.teams,
    History.currentRobotOnly(seasonRecords, state.robots),
  );
  get("teamwork-all-time").innerHTML =
    allTime
      .map((row) =>
        [
          `<tr><td>${row.rank ?? "--"}</td>`,
          `<td>${escapeText(row.id)}</td><td>${escapeText(row.name)}</td>`,
          `<td><strong>${row.best ?? "--"}</strong></td>`,
          `<td>${escapeText(row.bestDate)}</td><td>${row.played}</td></tr>`,
        ].join(""),
      )
      .join("") || '<tr><td colspan="6">No teams or saved Teamwork results.</td></tr>';
  const rows = Core.standings(state.teams, state.matches);
  get("mini-standings").innerHTML = rows.length
    ? rows
        .map((row, index) =>
          [
            `<div class="mini-row"><span>${index + 1}</span><div><b>${escapeText(row.id)}</b>`,
            `<small>${escapeText(row.name)} / ${row.played} played</small></div>`,
            `<strong>${average(row.average)}</strong></div>`,
          ].join(""),
        )
        .join("")
    : '<p class="empty">No teams registered.</p>';
  if (state.selectedPhase === "finals")
    get("mini-standings").innerHTML =
      Finals.outcome(state.finals)
        .rows.map((row) =>
          [
            `<div class="mini-row"><span>${row.rank ?? "--"}</span><div><b>${row.teams.map(escapeText).join(" + ")}</b>`,
            `<small>Finals seed ${row.seed}</small></div>`,
            `<strong>${row.score ?? "--"}</strong></div>`,
          ].join(""),
        )
        .join("") || '<p class="empty">No finals scheduled.</p>';
  get("standings").innerHTML = rows
    .map((row, index) => {
      const history =
        row.entries
          .map((entry) => {
            const stateClass = row.excluded.includes(entry.match)
              ? "dropped"
              : entry.protected
                ? "protected"
                : "";
            const title = row.excluded.includes(entry.match)
              ? " - dropped"
              : entry.protected
                ? " - no show, retained"
                : "";
            return `<span class="history-score ${stateClass}" title="Q${entry.match}${title}">Q${entry.match}: ${entry.score}</span>`;
          })
          .join("") || "--";
      return [
        `<tr><td>${index + 1}</td><td>${escapeText(row.id)}</td>`,
        `<td>${escapeText(row.name)}</td><td>${row.played}</td>`,
        `<td>${row.excluded.length}</td><td><strong>${average(row.average)}</strong></td>`,
        `<td>${history}</td></tr>`,
      ].join("");
    })
    .join("");
}

/**
 * Updates the schedule-size estimate from included teams and round count.
 *
 * @returns {void}
 */
function updateEstimate() {
  const rounds = Number(get("rounds").value);
  const included = state.teams.filter((team) => team.includeInSchedule !== false).length;
  const count = included < 2 ? 0 : Math.ceil(included / 2) * rounds;
  get("schedule-estimate").textContent =
    `${count} matches / ${included} of ${state.teams.length} teams included${included % 2 && included > 1 ? " / * extra appearances" : ""}${rounds < 6 ? " / practice format (under T9 minimum)" : ""}`;
}

/**
 * Reads a value from a nested goal object using a property path.
 *
 * @param {object} goals - Game-owned goal draft.
 * @param {Array<string|number>} path - Property/index path.
 * @returns {unknown}
 */
function goalPath(goals, path) {
  return path.reduce((value, key) => value[key], goals);
}

/**
 * Describes one game-defined calculator input.
 *
 * @typedef {object} GoalCounterInput
 * @property {Array<string|number>} path Path through the game-owned goals object.
 * @property {string} label Visible counter label.
 * @property {number} element Index into the game's scoring elements.
 * @property {string} [ariaLabel] Accessible label for the input.
 * @property {string} [counterLabel] Object label used by the stepper buttons.
 * @property {string} [object] Singular object name used by button tooltips.
 * @property {string} [objects] Plural object name used in the count display.
 * @property {number} [max] Per-input count limit.
 * @property {Partial<Record<import("./types").PracticeMode, number>>} [maxByMode] Mode-specific input limits.
 */
/**
 * Returns accessible counter markup with the game's point value and limit.
 *
 * @param {GoalCounterInput} input - Game layout counter descriptor.
 * @param {{goals:unknown}} [scoringDraft=draft] - Draft whose goal value initializes the input.
 * @param {string} [prefix="goal"] - Input ID prefix.
 * @param {import("./types").PracticeMode|null} [mode=null] - Current mode for mode-specific limits.
 * @returns {string}
 */
function goalCounter(input, scoringDraft = draft, prefix = "goal", mode = null) {
  const { object, objects, maxObjects, elements } = ACTIVE_GAME.scoring;
  const count = goalPath(scoringDraft.goals, input.path);
  const id = `${prefix}-${input.path.join("-")}`;
  const label = escapeText(input.ariaLabel || input.label);
  const counterLabel = escapeText(input.counterLabel || `${label} ${input.objects || objects}`.trim());
  const itemObject = input.object || object;
  const itemObjects = input.objects || objects;
  const inputMax = input.maxByMode?.[mode] ?? input.max ?? maxObjects;
  const points = elements[input.element].points;
  const decrement = `<button type="button" data-step="-1" data-counter="${id}" aria-label="Decrease ${counterLabel}" title="Remove one ${itemObject}">&minus;</button>`;
  const valueInput = [
    `<input id="${id}" aria-label="${counterLabel}"`,
    ` data-goal-path="${input.path.join(".")}" data-goal-points="${points}"`,
    ` data-goal-max="${inputMax ?? ""}" type="number" inputmode="numeric"`,
    ` min="0"${inputMax ? ` max="${inputMax}"` : ""} step="1" value="${count}" required>`,
  ].join("");
  const increment = `<button type="button" data-step="1" data-counter="${id}" aria-label="Increase ${counterLabel}" title="Add one ${itemObject}">+</button>`;
  return [
    `<div class="goal-counter"><label for="${id}">${escapeText(input.label)}</label>`,
    '<div class="goal-stepper">',
    decrement,
    valueInput,
    increment,
    `</div><small>${points} ${points === 1 ? "pt" : "pts"}</small></div>`,
  ].join("");
}

// Builds the scoring grid from the active game's layout (see games/).
/**
 * Replaces the mount point's contents with game-defined scoring controls.
 *
 * @param {HTMLElement} [container=#scoring-inputs] - Mount point.
 * @param {{goals:unknown}} [scoringDraft=draft] - Goal data for the rendered controls.
 * @param {string} [prefix="goal"] - Input ID prefix.
 * @param {import("./types").PracticeMode|null} [mode=null] - Filters counters to the selected practice mode.
 * @returns {void}
 */
function renderScoringInputs(
  container = get("scoring-inputs"),
  scoringDraft = draft,
  prefix = "goal",
  mode = null,
) {
  container.innerHTML = ACTIVE_GAME.layout
    .map((group) => ({
      ...group,
      inputs: group.inputs.filter((input) => !input.modes || !mode || input.modes.includes(mode)),
    }))
    .filter((group) => group.inputs.length && (!group.optional || group.optional(scoringDraft.goals)))
    .map((group) => {
      const note = group.note ? `<p class="legacy-goals-note">${escapeText(group.note)}</p>` : "";
      const counters = group.inputs.map((input) => goalCounter(input, scoringDraft, prefix, mode)).join("");
      return [
        `<section class="goal-group goal-${group.id}" style="--goal-color:${group.color};--goal-wash:${group.wash}" aria-label="${escapeText(group.title)}">`,
        `<div class="goal-group-heading"><h3>${escapeText(group.title)}</h3><span data-group-total="${group.id}">0 pts</span></div>`,
        note,
        `<div class="goal-group-body"><div class="goal-counters">${counters}</div>${group.diagram || ""}</div>`,
        "</section>",
      ].join("");
    })
    .join("");
}

/**
 * Loads the selected match into the score draft and refreshes the match UI.
 *
 * @param {number|null} id - Match ID to select.
 * @param {boolean} [save=true] - Whether local selection changes should persist.
 * @param {"qualification"|"finals"} [phase=state.selectedPhase] - Match phase.
 * @returns {void}
 */
function loadMatch(id, save = true, phase = state.selectedPhase) {
  state.selectedPhase = phase;
  state.selected = id;
  dirty = false;
  remaining = MATCH_MS;
  const match = currentMatch();
  if (!match) {
    render();
    return;
  }
  draft = match.result
    ? JSON.parse(JSON.stringify(match.result))
    : {
        counts: Core.emptyCounts(),
        statuses: Object.fromEntries(match.teams.map((team) => [team, "ok"])),
        ...(phase === "finals" ? { stopTime: 0 } : {}),
      };
  draft.goals = draft.goals || Core.goalsFromCounts(draft.counts);
  get("current-match").textContent =
    phase === "finals"
      ? `Finals ${match.id} / Seed ${match.seed}${match.round > 1 ? ` / Tiebreaker ${match.round - 1}` : ""}`
      : `Qualification ${match.id}`;
  get("match-status").textContent =
    phase === "qualification" && state.finals.length
      ? "Locked for finals"
      : match.result
        ? "Posted"
        : "Ready";
  const allianceTeams = match.teams
    .map(
      (id) =>
        `<div class="alliance-team"><b>${escapeText(id)}${match.surrogate === id ? "*" : ""}</b><span>${escapeText(teamName(id))}${match.surrogate === id ? " / extra, not ranked" : ""}</span></div>`,
    )
    .join('<span class="alliance-join" aria-hidden="true">+</span>');
  get("alliance").innerHTML = [
    `<p class="alliance-label">${match.result ? "Alliance" : "On the field"}${match.teams.length === 1 ? " / solo" : ""}</p>`,
    `<div class="alliance-teams">${allianceTeams}</div>`,
  ].join("");
  renderScoringInputs();
  get("team-statuses").innerHTML = match.teams
    .map((id, index) => {
      const options = [
        '<option value="ok">Regular score</option>',
        `<option value="dq">${phase === "finals" ? "DQ (entire alliance gets 0)" : "Disqualified (0)"}</option>`,
        `<option value="absent">${phase === "finals" ? "No show" : "No show (0, never dropped)"}</option>`,
      ].join("");
      return [
        `<label>${escapeText(id)} result`,
        `<select id="status-${index}" data-status="${escapeText(id)}" aria-label="${escapeText(id)} result">`,
        options,
        "</select></label>",
      ].join("");
    })
    .join("");
  match.teams.forEach((id, index) => {
    get(`status-${index}`).value = draft.statuses[id];
  });
  get("clear-result").hidden = !match.result;
  get("save-score").textContent = match.result ? "Update score" : "Post score";
  get("finals-stop-field").hidden = phase !== "finals" || match.round === 1;
  get("finals-stop-time").value = draft.stopTime || 0;
  render();
  updateScore();
  updateTimer();
  // In the shared app the selected match is each operator's own view, so choosing one does not save the event.
  if (save && !globalThis.EventStorage.shared) persist();
}

/**
 * Returns whether the current goal input is valid under game rules and limits.
 *
 * @param {HTMLElement} container - Scoring-control container.
 * @param {{counts:number[],goals:unknown}} scoringDraft - Mutable score draft.
 * @param {HTMLOutputElement|HTMLElement} totalOutput - Overall score output.
 * @param {HTMLElement} objectCountOutput - Placed-object count and validity output.
 * @returns {boolean}
 */
function updateCalculator(container, scoringDraft, totalOutput, objectCountOutput) {
  const { objects, maxObjects } = ACTIVE_GAME.scoring;
  const inputs = [...container.querySelectorAll("[data-goal-path]")];
  /**
   * Reads a scoring input as a number.
   *
   * @param {HTMLInputElement} input Scoring input.
   * @returns {number} Numeric input value, or NaN when blank.
   */
  const valueOf = (input) => (input.value === "" ? NaN : Number(input.value));
  const goals = ACTIVE_GAME.emptyGoals();
  inputs.forEach((input) => {
    const path = input.dataset.goalPath.split(".").map((key) => (/^\d+$/.test(key) ? Number(key) : key));
    goalPath(goals, path.slice(0, -1))[path[path.length - 1]] = valueOf(input);
  });
  scoringDraft.goals = goals;
  const placed = inputs.reduce((sum, input) => sum + valueOf(input), 0);
  const exceedsInputMax = inputs.some(
    (input) =>
      input.dataset.goalMax !== "" &&
      Number.isFinite(valueOf(input)) &&
      valueOf(input) > Number(input.dataset.goalMax),
  );
  objectCountOutput.textContent = `${Number.isFinite(placed) ? placed : "--"}${maxObjects ? ` / ${maxObjects}` : ""} ${objects}`;
  let valid = false;
  try {
    if (exceedsInputMax) throw new Error("This input exceeds its mode limit.");
    scoringDraft.counts = Core.goalCounts(goals);
    totalOutput.textContent = Core.score(scoringDraft.counts);
    valid = true;
  } catch {
    totalOutput.textContent = "--";
  }
  container.querySelectorAll("[data-group-total]").forEach((output) => {
    const total = [...output.closest(".goal-group").querySelectorAll("[data-goal-path]")].reduce(
      (sum, input) => sum + valueOf(input) * Number(input.dataset.goalPoints),
      0,
    );
    output.textContent = Number.isFinite(total) ? `${total} pts` : "--";
  });
  container.querySelectorAll("[data-step]").forEach((button) => {
    const input = get(button.dataset.counter);
    const value = Number(input.value);
    const increasing = Number(button.dataset.step) > 0;
    const inputMax = input.dataset.goalMax === "" ? maxObjects : Number(input.dataset.goalMax);
    button.disabled =
      !Number.isInteger(value) ||
      value < 0 ||
      (increasing
        ? !Number.isFinite(placed) ||
          (maxObjects && placed >= maxObjects) ||
          (Number.isFinite(inputMax) && value >= inputMax)
        : value === 0);
  });
  objectCountOutput.classList.toggle("score-invalid", !valid);
  return valid;
}

/**
 * Recalculates and validates the active match score, then updates posting controls.
 *
 * @returns {void}
 */
function updateScore() {
  const valid = updateCalculator(get("scoring-inputs"), draft, get("score-total"), get("bag-total"));
  const stop = Number(get("finals-stop-time").value);
  const validStop =
    currentMatch()?.phase !== "finals" ||
    currentMatch().round === 1 ||
    (get("finals-stop-time").value !== "" && Number.isInteger(stop) && stop >= 0 && stop <= MATCH_MS / 1000);
  const locked = state.selectedPhase === "qualification" && state.finals.length > 0;
  // Team members can post an unscored match but cannot change or remove a posted result.
  const memberLocked = isMember() && Boolean(currentMatch()?.result);
  get("save-score").disabled =
    !valid || !validStop || locked || memberLocked || deadline !== null || globalThis.TimerAudio.isStarting();
  get("save-score").hidden = memberLocked;
  get("clear-result").disabled = locked;
  if (isMember()) get("clear-result").hidden = true;
  for (const id of ["scoring-inputs", "team-statuses", "finals-stop-field"]) get(id).inert = memberLocked;
  get("reset-score").disabled = memberLocked;
  if (memberLocked && !locked) get("match-status").textContent = "Posted / coach can correct";
  if (valid && currentMatch()?.phase === "finals")
    get("score-total").textContent = Finals.score({ ...currentMatch(), result: draft });
  updateFlowNext();
}

// Reset only applies to a stopped timer that has moved off the full minute.
/**
 * Returns whether the stopped match timer can be reset.
 *
 * @returns {boolean}
 */
const canResetTimer = () =>
  deadline === null && remaining !== MATCH_MS && !globalThis.TimerAudio.isStarting();

/**
 * Updates the match clock, phase label, timer controls, and score validity.
 *
 * @returns {void}
 */
function updateTimer() {
  syncScreenWakeLock();
  const seconds = Math.ceil(Math.min(MATCH_MS, remaining) / 1000);
  get("timer").textContent = clockText(remaining);
  get("timer-dial").style.setProperty("--timer-progress-angle", timerProgressAngle(remaining));
  get("timer-stage").classList.toggle(
    "warning",
    seconds > 0 && Core.TIMING.driverSwitch !== null && seconds * 1000 <= Core.TIMING.driverSwitch.openMs,
  );
  get("timer-stage").classList.toggle("ended", seconds === 0);
  get("timer-label").textContent =
    seconds === 0
      ? "MATCH COMPLETE"
      : deadline !== null
        ? inSwitchWindow(seconds * 1000)
          ? "DRIVER SWITCH WINDOW"
          : "MATCH IN PROGRESS"
        : remaining === MATCH_MS
          ? "READY FOR MATCH"
          : "MATCH PAUSED";
  if (remaining > MATCH_MS && get("timer-countdown").checked)
    get("timer-label").textContent =
      `STARTING IN ${globalThis.TimerAudio.countdownNumber(remaining - MATCH_MS)}`;
  get("start-timer").textContent =
    deadline !== null ? "Pause match" : remaining === MATCH_MS ? "Start match" : "Resume match";
  if (globalThis.TimerAudio.isStarting()) get("timer-label").textContent = "PREPARING TIMER";
  get("start-timer").disabled = seconds === 0 || globalThis.TimerAudio.isStarting();
  get("reset-timer").disabled = !canResetTimer();
  get("finals-stop-time").disabled = deadline !== null || globalThis.TimerAudio.isStarting();
  get("end-finals-early").disabled = deadline === null || remaining > MATCH_MS;
  if (currentMatch()) updateScore();
}

/**
 * Validates, adds, persists, and renders teams; throws if locked or invalid.
 *
 * @param {Array<[string,string]>} entries - Team ID/name pairs to append.
 * @returns {void}
 */
function addTeams(entries) {
  if (state.matches.length || state.skills.length) throw new Error("End the event before adding teams.");
  if (state.teams.length + entries.length > 200)
    throw new Error("This local event supports up to 200 teams.");
  const known = new Set(state.teams.map((team) => team.id));
  const draws = new Set(state.teams.map((team) => team.draw));
  /**
   * Generates and reserves a draw value not already assigned to a team.
   *
   * @returns {number} Unique random draw value.
   */
  const uniqueDraw = () => {
    let draw;
    do draw = crypto.getRandomValues(new Uint32Array(1))[0];
    while (draws.has(draw));
    draws.add(draw);
    return draw;
  };
  const additions = entries.map(([rawId, rawName]) => {
    const id = rawId.trim().toUpperCase();
    const name = rawName.trim();
    if (!/^[A-Z0-9-]{1,20}$/.test(id) || !name || name.length > 80 || known.has(id))
      throw new Error(`Invalid or duplicate team: ${id || "(blank)"}. Use a unique number and a team name.`);
    known.add(id);
    return { id, name, draw: uniqueDraw() };
  });
  state.teams.push(...additions);
  rosterSort = null;
  persist();
  render();
}

/**
 * Clears the team editor and exits edit mode.
 *
 * @returns {void}
 */
function resetTeamEditor() {
  editingTeam = null;
  get("team-form").reset();
}

/**
 * Builds the escaped current-robot label, or an empty string when no version exists.
 *
 * @param {string} id - Team ID.
 * @returns {string}
 */
function robotLabel(id) {
  const robot = History.currentRobot(state.robots, id);
  return robot
    ? `<small class="robot-label">Robot: ${escapeText(robot.name)} (from ${escapeText(History.localDate(robot.startedAt))})</small>`
    : "";
}

/**
 * Converts a timestamp to the value format expected by a local datetime input.
 *
 * @param {string} value - Date/time string from a local datetime input.
 * @returns {string}
 */
function localInputTime(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Starts a new robot-version entry and resets the robot editor form.
 *
 * @returns {void}
 */
function resetRobotForm() {
  editingRobot = null;
  get("robot-form").reset();
  get("robot-name").value = `Robot ${History.robotVersions(state.robots, robotTeam).length + 2}`;
  get("robot-started").value = localInputTime(new Date().toISOString());
  get("robot-form-title").textContent = "Mark a new robot";
  get("save-robot").textContent = "Add robot";
  get("cancel-robot-edit").hidden = true;
  get("robot-error").textContent = "";
}

/**
 * Returns most recent preceding active version name, or "Original robot".
 *
 * @param {import("./types").RobotVersion} robot - Robot version.
 * @returns {string}
 */
function previousRobotName(robot) {
  const earlier = History.robotVersions(state.robots, robot.team).filter(
    (item) =>
      item.id !== robot.id &&
      item.abandonedAt === undefined &&
      Date.parse(item.startedAt) <= Date.parse(robot.startedAt),
  );
  return earlier.length ? earlier[earlier.length - 1].name : "Original robot";
}

/**
 * Renders robot versions and their current/abandoned status in the dialog.
 *
 * @returns {void}
 */
function renderRobots() {
  const versions = History.robotVersions(state.robots, robotTeam);
  const current = History.currentRobot(state.robots, robotTeam);
  get("robot-dialog-title").textContent = `Robot versions / ${robotTeam}`;
  /**
   * Renders the current or abandoned status for a robot version.
   *
   * @param {import("./types").RobotVersion} robot Robot version.
   * @returns {string} Status markup.
   */
  const status = (robot) =>
    robot === current
      ? " <small>Current</small>"
      : robot.abandonedAt !== undefined
        ? ` <small class="robot-abandoned">Abandoned ${escapeText(History.localDate(robot.abandonedAt))}</small>`
        : "";
  const originalRow = [
    `<tr${current ? "" : ' class="current-robot"'}>`,
    `<td>Original robot${current ? "" : " <small>Current</small>"}</td>`,
    "<td>Before first version</td>",
    "<td>Results before the first marked robot</td><td></td></tr>",
  ].join("");
  const versionRows = versions.map((robot) => {
    const rowClass =
      robot === current
        ? ' class="current-robot"'
        : robot.abandonedAt !== undefined
          ? ' class="abandoned-robot"'
          : "";
    const restoreButton =
      robot.abandonedAt !== undefined
        ? `<button type="button" data-restore-robot="${escapeText(robot.id)}" aria-label="Restore ${escapeText(robot.name)}" title="Count this robot's results again">Restore</button>`
        : "";
    const actions = [
      '<div class="roster-actions">',
      `<button type="button" data-edit-robot="${escapeText(robot.id)}" aria-label="Edit ${escapeText(robot.name)}">Edit</button>`,
      restoreButton,
      `<button type="button" class="danger" data-remove-robot="${escapeText(robot.id)}" aria-label="Remove ${escapeText(robot.name)}">Remove</button>`,
      "</div>",
    ].join("");
    return [
      `<tr${rowClass}><td>${escapeText(robot.name)}${status(robot)}</td>`,
      `<td>${escapeText(History.localDateTime(robot.startedAt))}</td>`,
      `<td>${escapeText(robot.notes)}</td><td>${actions}</td></tr>`,
    ].join("");
  });
  get("robot-rows").innerHTML = [originalRow, ...versionRows].join("");
}

/**
 * Closes the robot-removal confirmation panel and restores the editor form.
 *
 * @returns {void}
 */
function closeRobotRemoval() {
  removingRobot = null;
  get("robot-remove-panel").hidden = true;
  get("robot-form").hidden = false;
}

/**
 * Opens and initializes the robot-version dialog.
 *
 * @param {string} teamId - Team whose robot versions will be managed.
 * @returns {void}
 */
function openRobots(teamId) {
  robotTeam = teamId;
  closeRobotRemoval();
  resetRobotForm();
  renderRobots();
  get("robot-dialog").showModal();
  get("robot-name").focus();
  get("robot-name").select();
}

get("close-robots").addEventListener("click", () => get("robot-dialog").close());
get("cancel-robot-edit").addEventListener("click", () => {
  resetRobotForm();
  get("robot-name").focus();
});
get("robot-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const date = new Date(get("robot-started").value);
    if (!get("robot-started").value || !Number.isFinite(date.getTime()))
      throw new Error("Enter a valid robot start date/time.");
    const previous = editingRobot === null ? null : state.robots.find((robot) => robot.id === editingRobot);
    if (editingRobot !== null && !previous)
      throw new Error("This robot version no longer exists. Reload the latest data.");
    const robot = {
      id: previous ? previous.id : History.newId(),
      team: robotTeam,
      name: get("robot-name").value.trim(),
      startedAt:
        previous && localInputTime(previous.startedAt) === get("robot-started").value
          ? previous.startedAt
          : date.toISOString(),
      notes: get("robot-notes").value.trim(),
    };
    if (!robot.name) throw new Error("Enter a robot name.");
    if (previous && previous.abandonedAt !== undefined) {
      if (Date.parse(robot.startedAt) > Date.parse(previous.abandonedAt))
        throw new Error(
          `The start must be before this robot was abandoned (${History.localDateTime(previous.abandonedAt)}).`,
        );
      robot.abandonedAt = previous.abandonedAt;
    }
    state.robots = History.validateRobots([...state.robots.filter((item) => item.id !== robot.id), robot]);
    persist();
    render();
    resetRobotForm();
    renderRobots();
  } catch (error) {
    get("robot-error").textContent = error.message;
  }
});
get("robot-rows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-robot],[data-restore-robot],[data-remove-robot]");
  if (!button) return;
  const robot = state.robots.find(
    (item) =>
      item.id === (button.dataset.editRobot || button.dataset.restoreRobot || button.dataset.removeRobot),
  );
  if (!robot) return;
  if (button.dataset.editRobot) {
    closeRobotRemoval();
    editingRobot = robot.id;
    get("robot-name").value = robot.name;
    get("robot-started").value = localInputTime(robot.startedAt);
    get("robot-notes").value = robot.notes;
    get("robot-form-title").textContent = `Edit ${robot.name}`;
    get("save-robot").textContent = "Save robot";
    get("cancel-robot-edit").hidden = false;
    get("robot-error").textContent = "";
    get("robot-name").focus();
    return;
  }
  if (button.dataset.restoreRobot) {
    state.robots = History.restoreRobot(state.robots, robot.id);
    persist();
    render();
    renderRobots();
    return;
  }
  removingRobot = robot.id;
  const abandoned = robot.abandonedAt !== undefined;
  const previous = previousRobotName(robot);
  get("robot-remove-title").textContent = `Remove ${robot.name}?`;
  get("robot-remove-message").textContent = abandoned
    ? `${robot.name} was abandoned, so its results are excluded. Deleting it gives those results to ${previous}. Saved scores are not changed.`
    : `Choose what happens to results recorded with ${robot.name}. Saved scores are never deleted either way.`;
  get("robot-remove-merge").textContent = abandoned
    ? `Delete and count results for ${previous}`
    : `Count results for ${previous}`;
  get("robot-remove-merge-help").textContent = abandoned
    ? ""
    : `${previous} gets credit for these results, as if ${robot.name} never existed.`;
  get("robot-remove-abandon").hidden = abandoned;
  get("robot-remove-abandon-help").hidden = abandoned;
  get("robot-form").hidden = true;
  get("robot-remove-panel").hidden = false;
  get("cancel-robot-remove").focus();
});
get("cancel-robot-remove").addEventListener("click", closeRobotRemoval);
get("robot-remove-merge").addEventListener("click", () => {
  state.robots = state.robots.filter((item) => item.id !== removingRobot);
  if (editingRobot === removingRobot) resetRobotForm();
  closeRobotRemoval();
  persist();
  render();
  renderRobots();
});
get("robot-remove-abandon").addEventListener("click", () => {
  try {
    state.robots = History.abandonRobot(state.robots, removingRobot);
    if (editingRobot === removingRobot) resetRobotForm();
    closeRobotRemoval();
    persist();
    render();
    renderRobots();
  } catch (error) {
    closeRobotRemoval();
    get("robot-error").textContent = error.message;
  }
});

/**
 * Starts a browser download and revokes its temporary URL.
 *
 * @param {string|BlobPart[]} content - Download contents.
 * @param {string} name - Suggested download filename.
 * @param {string} type - Blob MIME type.
 * @returns {void}
 */
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

get("dismiss-notice").addEventListener("click", () => {
  get("notice").hidden = true;
  get("notice-message").textContent = "";
});
get("analysis-rows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-analysis-team]");
  if (!button) return;
  if (analysisTeam !== button.dataset.analysisTeam) analysisRobot = "current";
  analysisTeam = button.dataset.analysisTeam;
  renderTeamAnalysis();
  get("team-analysis-heading").focus();
});
document.querySelectorAll("[data-analysis-sort]").forEach((button) =>
  button.addEventListener("click", () => {
    const field = button.dataset.analysisSort;
    // Points-based columns start highest first; rank, text, and missing-data count start lowest first.
    const initial = ["skillsPoints", "teamworkPoints", "notebookPoints", "interviewPoints", "total"].includes(
      field,
    )
      ? "descending"
      : "ascending";
    analysisSort = {
      field,
      direction:
        analysisSort.field === field
          ? analysisSort.direction === "ascending"
            ? "descending"
            : "ascending"
          : initial,
    };
    renderHistory();
  }),
);
get("analysis-source").addEventListener("change", renderHistory);
get("v5-analysis-team").addEventListener("change", (event) => {
  analysisTeam = event.target.value || null;
  renderTeamAnalysis(ACTIVE_GAME.practiceOnly ? state.teams : analysisRanking());
});
get("team-analysis-robot").addEventListener("change", (event) => {
  analysisRobot = event.target.value;
  renderTeamAnalysis();
});
get("close-team-analysis").addEventListener("click", () => {
  const previous = analysisTeam;
  analysisTeam = null;
  get("team-analysis").hidden = true;
  [...get("analysis-rows").querySelectorAll("[data-analysis-team]")]
    .find((button) => button.dataset.analysisTeam === previous)
    ?.focus();
});
get("open-access").addEventListener("click", () => {
  if (!storageReady || !canManageAccess()) return;
  tab("access");
  const heading = get("access-view").querySelector("h2");
  heading.tabIndex = -1;
  heading.focus();
});
get("open-history").addEventListener("click", (event) => {
  event.preventDefault();
  if (!storageReady) return;
  tab("history");
  const heading = get("history-view").querySelector("h2");
  heading.tabIndex = -1;
  heading.focus();
  heading.scrollIntoView({ block: "start" });
});
document
  .querySelectorAll("[data-tab]")
  .forEach((button) => button.addEventListener("click", () => tab(button.dataset.tab)));
get("team-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (editingTeam === null) {
      addTeams([[get("team-id").value, get("team-name").value]]);
      resetTeamEditor();
    } else {
      const edited = Core.editTeam(
        state.teams,
        state.matches,
        editingTeam,
        get("team-id").value,
        get("team-name").value,
      );
      const editedFinals = Core.editTeam(
        state.teams,
        state.finals,
        editingTeam,
        get("team-id").value,
        get("team-name").value,
      );
      const changedId = get("team-id").value.trim().toUpperCase();
      const rubrics = globalThis.NotebookRubric.rename(
        state.rubrics,
        editingTeam,
        edited.teams.find((team) => team.id === changedId),
      );
      const interviews = globalThis.InterviewRubric.rename(
        state.interviews,
        editingTeam,
        edited.teams.find((team) => team.id === changedId),
      );
      if (!idle() || !(await discardDraft())) return;
      state.teams = edited.teams;
      state.matches = edited.matches;
      state.finals = editedFinals.matches;
      state.finalsWithdrawn = state.finalsWithdrawn.map((id) => (id === editingTeam ? changedId : id));
      state.rubrics = rubrics;
      state.interviews = interviews;
      state.robots = History.renameRobots(state.robots, editingTeam, changedId);
      state.skills = state.skills.map((entry) =>
        entry.team === editingTeam ? { ...entry, team: changedId } : entry,
      );
      globalThis.SkillsUI?.reset();
      globalThis.RubricUI?.reset();
      globalThis.InterviewUI?.reset();
      rosterSort = null;
      resetTeamEditor();
      if (currentMatch()) loadMatch(state.selected);
      else {
        persist();
        render();
      }
      notify("Team updated. Existing match results have been preserved.");
    }
    get("team-id").focus();
  } catch (error) {
    notify(error.message);
  }
});
get("cancel-team-edit").addEventListener("click", () => {
  resetTeamEditor();
  render();
});
get("roster").addEventListener("change", (event) => {
  const input = event.target.closest("[data-schedule-team]");
  if (!input) return;
  const team = state.teams.find((team) => team.id === input.dataset.scheduleTeam);
  if (!team) {
    notify("This team no longer exists. Reload the roster.");
    return;
  }
  if (state.matches.length) {
    input.checked = team.includeInSchedule !== false;
    notify("End the event before changing schedule inclusion.");
    return;
  }
  team.includeInSchedule = input.checked;
  persist();
  updateEstimate();
});
get("roster").addEventListener("click", async (event) => {
  const move = event.target.closest("[data-move]");
  if (move) {
    const index = state.teams.findIndex((team) => team.id === move.dataset.move);
    const target = index + Number(move.dataset.direction);
    if (index < 0 || target < 0 || target >= state.teams.length) return;
    [state.teams[index], state.teams[target]] = [state.teams[target], state.teams[index]];
    rosterSort = null;
    persist();
    render();
    const controls = [...get("roster").querySelectorAll("[data-move]")].filter(
      (button) => button.dataset.move === move.dataset.move && !button.disabled,
    );
    (controls.find((button) => button.dataset.direction === move.dataset.direction) || controls[0])?.focus();
    return;
  }
  const robots = event.target.closest("[data-robots]");
  if (robots) {
    openRobots(robots.dataset.robots);
    return;
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    if (!idle()) return;
    const team = state.teams.find((team) => team.id === edit.dataset.edit);
    if (!team) return;
    editingTeam = team.id;
    render();
    get("team-id").value = team.id;
    get("team-name").value = team.name;
    get("team-name").focus();
    return;
  }
  const button = event.target.closest("[data-remove]");
  if (!button || state.matches.length || state.skills.length) return;
  if (!idle() || !(await discardDraft())) return;
  if (editingTeam === button.dataset.remove) resetTeamEditor();
  state.teams = state.teams.filter((team) => team.id !== button.dataset.remove);
  rosterSort = null;
  persist();
  render();
});
document.querySelectorAll("[data-roster-sort]").forEach((button) =>
  button.addEventListener("click", () => {
    const field = button.dataset.rosterSort;
    const direction =
      rosterSort?.field === field && rosterSort.direction === "ascending" ? "descending" : "ascending";
    /**
     * Compares roster values using natural, case-insensitive ordering.
     *
     * @param {string} left First roster value.
     * @param {string} right Second roster value.
     * @returns {number} Natural ordering result.
     */
    const compare = (left, right) => left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
    state.teams.sort(
      (left, right) =>
        (compare(left[field], right[field]) || compare(left.id, right.id)) *
        (direction === "descending" ? -1 : 1),
    );
    rosterSort = { field, direction };
    persist();
    render();
  }),
);
get("rounds").addEventListener("input", updateEstimate);
get("schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.matches.length || !idle()) return;
  try {
    const rounds = Number(get("rounds").value);
    const matches = Core.schedule(state.teams, rounds);
    state.rounds = rounds;
    state.start = get("start-time").value;
    state.interval = Number(get("interval").value);
    state.matches = matches;
    loadMatch(matches[0].id, false, "qualification");
    tab("control");
    if (!(await persist())) return;
    notify(
      "Schedule created. An asterisk (*) marks an extra appearance that does not count toward that team's ranking.",
    );
  } catch (error) {
    notify(error.message);
  }
});
get("clear-schedule").addEventListener("click", async () => {
  if (
    !idle() ||
    !(await ask(
      "End this event? The active schedule and results will be cleared, and unposted edits discarded. Posted score history, saved notebook/interview evaluations, and your team roster will be kept.",
      "End event",
      true,
    ))
  )
    return;
  const next = {
    ...state,
    sessionId: History.newId(),
    matches: [],
    finals: [],
    finalsWithdrawn: [],
    selectedPhase: "qualification",
    skills: [],
    selected: null,
  };
  document.querySelector("main").inert = true;
  document.querySelector(".topbar").inert = true;
  const saved = await persist(next);
  document.querySelector("main").inert = Boolean(globalThis.EventStorage.conflicted);
  document.querySelector(".topbar").inert = false;
  if (!saved) return;
  state = next;
  dirty = false;
  resetTeamEditor();
  globalThis.SkillsUI?.reset();
  globalThis.PracticeUI?.reset();
  globalThis.RubricUI?.reset();
  globalThis.InterviewUI?.reset();
  render();
  notify("Event ended. Your roster, saved evaluations, and posted score history have been kept.");
});
document.querySelector(".match-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-match]");
  if (!button) return;
  const phase = button.dataset.phase;
  if (
    (Number(button.dataset.match) === state.selected && phase === state.selectedPhase) ||
    !idle() ||
    !(await discardDraft())
  )
    return;
  loadMatch(Number(button.dataset.match), true, phase);
});
get("generate-finals").addEventListener("click", async () => {
  if (!idle() || !(await discardDraft())) return;
  if (state.finals.length) {
    notify("Finals are already scheduled.");
    return;
  }
  get("finals-team-count").value = Math.min(
    Number(get("finals-team-count").max),
    Math.max(2, Number(get("finals-team-count").value) || 2),
  );
  get("finals-dialog").showModal();
  get("finals-team-count").focus();
});
get("cancel-finals").addEventListener("click", () => get("finals-dialog").close());
get("finals-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!idle()) return;
  try {
    if (state.finals.length) throw new Error("Finals are already scheduled.");
    const matches = Finals.generate(state.teams, state.matches, Number(get("finals-team-count").value));
    get("finals-dialog").close();
    state.finals = matches;
    loadMatch(matches[0].id, true, "finals");
    notify(
      `${matches.length} finals alliances created in play order, lowest seed first. Qualification scores are locked.`,
    );
  } catch (error) {
    notify(error.message);
  }
});
get("clear-finals").addEventListener("click", async () => {
  if (!idle() || !(await discardDraft())) return;
  if (
    state.history.some((record) => record.sessionId === state.sessionId && record.value.phase === "finals")
  ) {
    notify("Finals with score history cannot be discarded. End the event instead.");
    return;
  }
  if (
    !(await ask(
      "Discard the unplayed finals alliances and unlock qualification scores?",
      "Discard finals",
      true,
    ))
  )
    return;
  state.finals = [];
  state.finalsWithdrawn = [];
  loadMatch(state.matches[0]?.id ?? null, true, "qualification");
});
get("generate-tiebreaker").addEventListener("click", async () => {
  if (!idle() || !(await discardDraft())) return;
  try {
    const matches = Finals.tiebreakers(state.finals);
    state.finals = [...state.finals, ...matches];
    loadMatch(matches[0].id, true, "finals");
    notify(
      "First-place tiebreakers created. Record scores and Match Stop Time for every alliance in this series.",
    );
  } catch (error) {
    notify(error.message);
  }
});
get("void-tiebreaker").addEventListener("click", async () => {
  if (!idle() || !(await discardDraft())) return;
  const round = Math.max(...state.finals.map((match) => match.round));
  if (round < 2) {
    notify("There is no tiebreaker series to void.");
    return;
  }
  if (
    !(await ask(
      `Void tiebreaker series ${round - 1} and remove its results from standings? The audit history will be kept. You can then correct the preceding series and regenerate tiebreakers if needed.`,
      "Void series",
      true,
    ))
  )
    return;
  const history = state.finals
    .filter((match) => match.round === round && match.result)
    .map((match) => History.capture(state, "teamwork", match, "voided"));
  state.history = [...state.history, ...history];
  state.finals = state.finals.filter((match) => match.round < round);
  loadMatch(state.finals[0].id, true, "finals");
  notify("Latest tiebreaker series voided. Earlier results can now be corrected.");
});
get("finals-withdrawals").addEventListener("click", async (event) => {
  const withdraw = event.target.closest("[data-withdraw-final]");
  if (!withdraw || !idle() || !(await discardDraft())) return;
  try {
    const id = withdraw.dataset.withdrawFinal;
    const updated = Finals.withdraw(state.teams, state.matches, state.finals, state.finalsWithdrawn, id);
    if (
      !(await ask(
        `Withdraw ${id} from finals? ${updated.replacement ? `Replace with next available team ${updated.replacement}.` : "No replacement remains; the partner will play alone."}`,
        "Withdraw team",
        true,
      ))
    )
      return;
    state.finals = updated.matches;
    state.finalsWithdrawn = updated.withdrawn;
    loadMatch(state.selected, true);
    notify(
      `Finals team ${id} withdrawn. ${updated.replacement ? `Replaced by ${updated.replacement}.` : "Alliance will play alone."}`,
    );
  } catch (error) {
    notify(error.message);
  }
});
get("open-finals").addEventListener("click", async () => {
  tab("control");
  if (state.selectedPhase === "finals" || !idle() || !(await discardDraft())) return;
  const next = state.finals.find((match) => !match.result) || state.finals[0];
  if (next) loadMatch(next.id, true, "finals");
});
get("finals-stop-time").addEventListener("input", () => {
  dirty = true;
  updateScore();
});
get("end-finals-early").addEventListener("click", () => {
  if (
    deadline === null ||
    remaining > MATCH_MS ||
    currentMatch()?.phase !== "finals" ||
    currentMatch().round === 1
  ) {
    notify("Start a finals tiebreaker before recording an early stop.");
    return;
  }
  remaining = Math.max(0, deadline - globalThis.TimerAudio.now());
  get("finals-stop-time").value = Math.ceil(remaining / 1000);
  deadline = null;
  globalThis.TimerAudio.finish();
  remaining = 0;
  dirty = true;
  updateTimer();
});
get("score-form").addEventListener("input", (event) => {
  dirty = true;
  if (event.target.dataset.status) draft.statuses[event.target.dataset.status] = event.target.value;
  updateScore();
});
get("scoring-inputs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-step]");
  if (!button || button.disabled) return;
  const input = get(button.dataset.counter);
  input.value = Number(input.value) + Number(button.dataset.step);
  dirty = true;
  updateScore();
});
get("reset-score").addEventListener("click", async () => {
  if (![...get("scoring-inputs").querySelectorAll("[data-goal-path]")].some((input) => input.value !== "0"))
    return;
  if (
    !(await ask(
      "Reset all field bag counts? This changes the draft only; any posted result stays until you post an update.",
      "Reset counts",
      true,
    ))
  )
    return;
  draft.goals = ACTIVE_GAME.emptyGoals();
  renderScoringInputs();
  dirty = true;
  updateScore();
});
get("score-form").addEventListener("submit", (event) => {
  event.preventDefault();
  postScore();
});
/**
 * Posts or updates the current match after validation and confirmation.
 *
 * @returns {Promise<boolean>}
 */
async function postScore() {
  if (!idle() || !currentMatch() || qualificationLocked()) return false;
  try {
    draft.counts = Core.goalCounts(draft.goals);
    const match = currentMatch();
    if (match.phase === "finals") {
      if (state.finals.some((item) => item.round > match.round))
        throw new Error(
          "A later tiebreaker series is already scheduled. Void that series before correcting an earlier finals result.",
        );
      draft.stopTime = match.round > 1 ? Number(get("finals-stop-time").value) : 0;
      if (match.round > 1 && get("finals-stop-time").value === "")
        throw new Error("Enter a valid Match Stop Time.");
      Finals.validateMatch({ ...match, result: draft }, state.teams);
    }
    if (match.result && !(await ask(`Replace the posted result for ${matchLabel(match)}?`, "Replace result")))
      return false;
    const updated = { ...match, result: JSON.parse(JSON.stringify(draft)) };
    const key = match.phase === "finals" ? "finals" : "matches";
    const saving = saveResultChange(
      { ...state, [key]: state[key].map((item) => (item.id === match.id ? updated : item)) },
      "teamwork",
      updated,
      match.result ? "updated" : "posted",
    );
    dirty = false;
    render();
    get("match-status").textContent = "Posted";
    get("save-score").textContent = "Update score";
    get("clear-result").hidden = false;
    updateScore();
    if (!(await saving)) return false;
    notify(
      `${matchLabel(match)} posted: ${match.phase === "finals" ? Finals.score(updated) : Core.score(draft.counts)} alliance points. Score history saved.`,
    );
    return true;
  } catch (error) {
    notify(error.message);
    return false;
  }
}
get("clear-result").addEventListener("click", async () => {
  if (!idle() || !currentMatch() || qualificationLocked()) return;
  const match = currentMatch();
  if (match.phase === "finals" && state.finals.some((item) => item.round > match.round)) {
    notify("Void later tiebreaker series before removing this result.");
    return;
  }
  if (
    !(await ask(
      `Remove this posted result from standings?${dirty ? " Your unposted edits to this match will also be discarded." : ""}`,
      "Remove result",
      true,
    ))
  )
    return;
  const key = match.phase === "finals" ? "finals" : "matches";
  saveResultChange(
    { ...state, [key]: state[key].map((item) => (item.id === match.id ? { ...item, result: null } : item)) },
    "teamwork",
    match,
    "removed",
  );
  loadMatch(state.selected);
});
/**
 * Advances to the next unscored match after resolving the current draft.
 *
 * @returns {Promise<boolean>}
 */
async function goNextMatch() {
  if (!idle() || !(await discardDraft())) return false;
  const next =
    activeMatches().find((match) => match.id > state.selected && !match.result) ||
    activeMatches().find((match) => !match.result);
  if (next) {
    loadMatch(next.id);
    return true;
  }
  notify(
    state.selectedPhase === "finals"
      ? "All scheduled finals are posted. Check the finals list for any required tiebreakers."
      : state.finals.length
        ? "All qualification matches have posted results."
        : "All qualification matches have posted results. Use Generate finals below the qualification list to create alliances.",
  );
  return false;
}
get("next-match").addEventListener("click", goNextMatch);
const fieldControl = document.querySelector(".field-control");
/**
 * Switches the flow view and resets its scroll position.
 *
 * @param {"timer"|"score"} step - Fullscreen match-flow step.
 * @returns {void}
 */
function setFlowStep(step) {
  fieldControl.dataset.flowStep = step;
  get("flow-step-label").textContent = step === "score" ? "Score match" : "Timer";
  fieldControl.scrollTop = 0;
}
/**
 * Returns whether another active-phase match still needs a result.
 *
 * @param {import("./types").Match|import("./types").FinalsMatch|undefined} match - Current match.
 * @returns {boolean}
 */
const hasOtherUnscored = (match) => activeMatches().some((other) => other.id !== match?.id && !other.result);
/**
 * Updates the fullscreen flow's next/post/exit action from match and draft state.
 *
 * @returns {void}
 */
function updateFlowNext() {
  const match = currentMatch();
  const needsPost = !match?.result || dirty;
  const last = !hasOtherUnscored(match);
  get("flow-next").textContent = last
    ? needsPost
      ? "Post & exit full screen"
      : "Exit full screen"
    : needsPost
      ? "Post & next match \u2192"
      : "Next match \u2192";
  get("flow-next").disabled = !match || (needsPost && get("save-score").disabled);
}
/**
 * Opens fullscreen match flow and starts monitoring browser fullscreen exit.
 *
 * @returns {Promise<void>}
 */
async function enterFlow() {
  if (!currentMatch()) return;
  fieldControl.classList.add("flow-mode");
  document.body.classList.add("flow-open");
  syncScreenWakeLock();
  get("notice").hidden = true;
  setFlowStep("timer");
  updateFlowNext();
  try {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement)
      await document.documentElement.requestFullscreen();
  } catch {
    /* Overlay still fills the window when the browser blocks fullscreen. */
  }
  clearInterval(flowWatch);
  // Fallback for browsers that leave fullscreen without firing fullscreenchange.
  if (document.fullscreenElement)
    flowWatch = setInterval(() => {
      if (!document.fullscreenElement) exitFlow();
    }, 500);
}
let flowWatch = null;
/**
 * Closes fullscreen match flow, releases wake-lock demand, and exits browser fullscreen.
 *
 * @returns {void}
 */
function exitFlow() {
  if (!fieldControl.classList.contains("flow-mode")) return;
  fieldControl.classList.remove("flow-mode");
  document.body.classList.remove("flow-open");
  syncScreenWakeLock();
  delete fieldControl.dataset.flowStep;
  clearInterval(flowWatch);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) exitFlow();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    fieldControl.classList.contains("flow-mode") &&
    !document.fullscreenElement &&
    !document.querySelector("dialog[open]")
  )
    exitFlow();
});
get("flow-exit").addEventListener("click", exitFlow);
get("flow-score").addEventListener("click", () => setFlowStep("score"));
get("flow-back").addEventListener("click", () => setFlowStep("timer"));
get("flow-next").addEventListener("click", async () => {
  const match = currentMatch();
  if (!match) return;
  if ((!match.result || dirty) && !(await postScore())) return;
  // Exit before goNextMatch so its "all posted" notice stays on the normal page.
  if (!hasOtherUnscored(match)) exitFlow();
  if ((await goNextMatch()) && fieldControl.classList.contains("flow-mode")) setFlowStep("timer");
});
get("start-timer").addEventListener("click", async () => {
  if (globalThis.TimerAudio.isStarting()) {
    notify("Wait for the timer audio to become ready.");
    return;
  }
  if (globalThis.PracticeUI?.isRunning()) {
    notify("End the practice run before starting a teamwork match.");
    return;
  }
  if (globalThis.SkillsUI?.isRunning()) {
    notify("End the skills run before starting a teamwork match.");
    return;
  }
  if (deadline !== null) {
    remaining = Math.min(MATCH_MS, Math.max(0, deadline - globalThis.TimerAudio.now()));
    deadline = null;
    globalThis.TimerAudio.stop();
  } else {
    if (remaining <= 0) return;
    if (remaining === MATCH_MS) clearFinalsStopTime();
    const ready = globalThis.TimerAudio.start(remaining, remaining === MATCH_MS, true);
    updateTimer();
    deadline = await ready;
    if (deadline !== null) remaining = Math.max(0, deadline - globalThis.TimerAudio.now());
  }
  updateTimer();
});
get("reset-timer").addEventListener("click", () => {
  if (!canResetTimer()) return;
  clearFinalsStopTime();
  deadline = null;
  remaining = MATCH_MS;
  updateTimer();
});
get("fullscreen").addEventListener("click", enterFlow);
setInterval(() => {
  if (deadline === null) return;
  remaining = Math.max(0, deadline - globalThis.TimerAudio.now());
  if (remaining === 0) deadline = null;
  updateTimer();
}, 25);
const settingsTray = get("settings-tray");
get("open-settings").addEventListener("click", () => settingsTray.showModal());
get("open-settings").addEventListener("click", renderStudentPreviewControls);
get("close-settings").addEventListener("click", () => settingsTray.close());
settingsTray.addEventListener("click", (event) => {
  if (event.target === settingsTray) settingsTray.close();
});
settingsTray.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    settingsTray.close();
  }
});
settingsTray
  .querySelectorAll("section button")
  .forEach((button) => button.addEventListener("click", () => settingsTray.close()));
get("open-settings").addEventListener("click", renderStudentPreviewControls);
get("preview-student-view").addEventListener("click", async () => {
  const team = get("preview-student-team").value;
  if (!canPreviewStudent() || !team) return;
  if (
    !idle() ||
    dirty ||
    unsaved ||
    globalThis.PracticeUI?.isDirty() ||
    globalThis.RubricUI?.isDirty() ||
    globalThis.InterviewUI?.isDirty()
  ) {
    notify("Finish or discard current work before starting a student preview.");
    return;
  }
  settingsTray.close();
  const main = document.querySelector("main");
  main.inert = true;
  document.querySelector(".topbar").inert = true;
  try {
    const preview = await globalThis.EventStorage.previewMember(team);
    state = validateState(preview);
    dirty = false;
    unsaved = false;
    staleNotice = false;
    rosterSort = null;
    resetTeamEditor();
    globalThis.SkillsUI?.reset();
    globalThis.PracticeUI?.reset();
    globalThis.RubricUI?.reset();
    globalThis.InterviewUI?.reset();
    render();
    applyAccess();
    tab(defaultTab(), false);
    setupHistory();
    notify(`Student preview opened for team ${team}. Changes will not be saved to the shared event.`);
  } catch (error) {
    notify(`Could not open student preview: ${error.message}`);
  } finally {
    main.inert = false;
    document.querySelector(".topbar").inert = false;
  }
});
get("exit-student-preview").addEventListener("click", async () => {
  if (!globalThis.EventStorage.previewing || !idle()) return;
  if (
    !(await ask(
      "Exit student preview? Practice runs and reviews created in the preview will be discarded.",
      "Exit preview",
      true,
    ))
  )
    return;
  await reloadEvent(false);
});
/**
 * Returns current-game preference, falling back to the legacy IQ key.
 *
 * @param {string} name - Preference key.
 * @returns {string|null}
 */
const iqPreference = (name) =>
  localStorage.getItem(`iq-${name}`) ?? localStorage.getItem(`${Game.LEGACY_GAME_ID}-${name}`);
try {
  if (iqPreference("sound") === "off") get("sound").checked = false;
} catch {}
/**
 * Synchronizes timer sound buttons with the saved sound preference.
 *
 * @returns {void}
 */
const syncSoundButtons = () =>
  document.querySelectorAll(".timer-sound-toggle").forEach((button) => {
    const enabled = get("sound").checked;
    button.setAttribute("aria-pressed", String(enabled));
    button.title = enabled ? "Disable timer sound" : "Enable timer sound";
    button.querySelector(".sound-icon-on").toggleAttribute("hidden", !enabled);
    button.querySelector(".sound-icon-off").toggleAttribute("hidden", enabled);
  });
get("sound").addEventListener("change", () => {
  try {
    localStorage.setItem("iq-sound", get("sound").checked ? "on" : "off");
  } catch {}
  syncSoundButtons();
});
document.querySelectorAll(".timer-sound-toggle").forEach((button) =>
  button.addEventListener("click", () => {
    get("sound").checked = !get("sound").checked;
    get("sound").dispatchEvent(new Event("change", { bubbles: true }));
  }),
);
syncSoundButtons();
try {
  if (iqPreference("countdown") === "off") get("timer-countdown").checked = false;
} catch {}
get("timer-countdown").addEventListener("change", () => {
  try {
    localStorage.setItem("iq-countdown", get("timer-countdown").checked ? "on" : "off");
  } catch {}
});
get("export-backup").addEventListener("click", async () => {
  if (
    (dirty ||
      globalThis.SkillsUI?.isDirty() ||
      globalThis.PracticeUI?.isDirty() ||
      globalThis.RubricUI?.isDirty() ||
      globalThis.InterviewUI?.isDirty()) &&
    !(await ask(
      "Unposted scores and unsaved evaluations are not included in backups. Export saved data anyway?",
      "Export anyway",
    ))
  )
    return;
  download(JSON.stringify(state, null, 2), fileName("event.json"), "application/json");
});
get("import-backup").addEventListener("click", async () => {
  if (idle() && (await discardDraft())) get("backup-file").click();
});
get("backup-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const { next: imported, from } = adoptGame(validateState(JSON.parse(await file.text())));
    imported.history = History.merge(state.history, imported.history);
    imported.rubrics = globalThis.NotebookRubric.merge(state.rubrics, imported.rubrics);
    imported.interviews = globalThis.InterviewRubric.merge(state.interviews, imported.interviews);
    imported.robots = [
      ...new Map([...state.robots, ...imported.robots].map((robot) => [robot.id, robot])).values(),
    ];
    if (
      !idle() ||
      !(await discardDraft()) ||
      !(await ask(
        "Replace the active event with this backup? Score history will be merged. Notebook and interview evaluations will keep the most recently saved version for each team.",
        "Replace event",
        true,
      ))
    )
      return;
    document.querySelector("main").inert = true;
    document.querySelector(".topbar").inert = true;
    const saved = await persist(imported);
    document.querySelector("main").inert = Boolean(globalThis.EventStorage.conflicted);
    document.querySelector(".topbar").inert = false;
    if (!saved) return;
    state = imported;
    dirty = false;
    rosterSort = null;
    resetTeamEditor();
    globalThis.SkillsUI?.reset();
    globalThis.PracticeUI?.reset();
    globalThis.RubricUI?.reset();
    globalThis.InterviewUI?.reset();
    if (activeMatches().length) loadMatch(state.selected || activeMatches()[0].id);
    else render();
    tab(state.matches.length ? "control" : "setup");
    notify(from ? `Event backup imported. ${rolloverMessage(from)}` : "Event backup imported.");
  } catch (error) {
    notify(`Import failed: ${error.message}`);
  } finally {
    event.target.value = "";
  }
});
get("export-finals").addEventListener("click", () => {
  const status = Finals.outcome(state.finals);
  const rows = [
    [
      "Place",
      "Seed",
      "Team",
      "Partner",
      "Finals score",
      "Tiebreaker 1 score",
      "Tiebreaker 1 Stop Time",
      "Tiebreaker 2 score",
      "Tiebreaker 2 Stop Time",
      "Complete",
    ],
    ...status.rows.flatMap((row) =>
      row.teams.map((id) => {
        const first = row.matches.find((match) => match.round === 2);
        const second = row.matches.find((match) => match.round === 3);
        return [
          row.rank ?? "",
          row.seed,
          id,
          row.teams.find((team) => team !== id) || "",
          row.score ?? "",
          first ? (Finals.score(first) ?? "") : "",
          first?.result?.stopTime ?? "",
          second ? (Finals.score(second) ?? "") : "",
          second?.result?.stopTime ?? "",
          status.complete,
        ];
      }),
    ),
  ];
  /**
   * Escapes one CSV cell and guards against spreadsheet formulas.
   *
   * @param {unknown} value CSV cell value.
   * @returns {string} Quoted, escaped, formula-safe CSV cell.
   */
  const cell = (value) => {
    const text = String(value);
    return `"${(/^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" : "") + text.replace(/"/g, '""')}"`;
  };
  download(
    rows.map((row) => row.map(cell).join(",")).join("\r\n"),
    fileName("finals.csv"),
    "text/csv;charset=utf-8",
  );
});
/**
 * Builds the printable schedule from current qualification and finals state.
 *
 * @returns {void}
 */
function renderPrintSheet() {
  /**
   * Renders a team ID and marks a surrogate appearance.
   *
   * @param {import("./types").Match} match Match being printed.
   * @param {string} id Team ID.
   * @returns {string} Escaped team ID with surrogate marker.
   */
  const team = (match, id) => `${escapeText(id)}${match.surrogate === id ? "*" : ""}`;
  /**
   * Renders one printable schedule row.
   *
   * @param {import("./types").Match} match Match to render.
   * @returns {string} Printable match table row.
   */
  const row = (match) => {
    const time = match.phase === "finals" ? `Seed ${match.seed}` : matchTime(match);
    const secondTeam = match.teams[1] ? team(match, match.teams[1]) : "&mdash;";
    const score = match.result
      ? match.phase === "finals"
        ? Finals.score(match)
        : Core.score(match.result.counts)
      : "";
    return [
      `<tr><td>${matchLabel(match)}</td><td>${time}</td>`,
      `<td>${team(match, match.teams[0])}</td><td>${secondTeam}</td>`,
      `<td>${score}</td></tr>`,
    ].join("");
  };
  /**
   * Renders a printable table when the section contains matches.
   *
   * @param {string} title Section heading.
   * @param {import("./types").Match[]} matches Matches to render.
   * @returns {string} Printable table markup or an empty string.
   */
  const table = (title, matches) =>
    matches.length
      ? [
          `<h3>${title}</h3><table><thead><tr>`,
          "<th>Match</th><th>Time</th><th>Team 1</th><th>Team 2</th><th>Score</th>",
          `</tr></thead><tbody>${matches.map(row).join("")}</tbody></table>`,
        ].join("")
      : "";
  const surrogateNote = state.matches.some((match) => match.surrogate)
    ? "<p>* Extra appearance; does not count toward that team&#39;s ranking.</p>"
    : "";
  get("print-sheet").innerHTML = [
    `<h2>${escapeText(state.name || `${ACTIVE_GAME.name} event`)} &mdash; Match schedule</h2>`,
    table("Qualifications", state.matches),
    table("Finals", state.finals),
    surrogateNote,
  ].join("");
}
window.addEventListener("beforeprint", renderPrintSheet);
get("print-schedule").addEventListener("click", () => {
  renderPrintSheet();
  window.print();
});
get("export-history").addEventListener("click", () => {
  try {
    download(History.csv(state.history, state.robots), fileName("all-scores.csv"), "text/csv;charset=utf-8");
  } catch (error) {
    notify(`Score export failed: ${error.message}`);
  }
});
get("export-analysis").addEventListener("click", () => {
  try {
    download(
      History.csv(History.resolve(state.history), state.robots, state.history),
      fileName("resolved-scores.csv"),
      "text/csv;charset=utf-8",
    );
  } catch (error) {
    notify(`Analysis export failed: ${error.message}`);
  }
});
// Backups are coach-only, so other roles are not told to export one.
/**
 * Returns backup advice only to coaches.
 *
 * @param {string} text - Backup advice.
 * @returns {string}
 */
function backupAdvice(text) {
  return accessRole() === "coach" ? text : "";
}
// The shared app refreshes itself, so Reload is offered only when that cannot happen: newer scores arrived while
// something is being edited, or a save was refused. Students and viewers get no Event data section otherwise.
/**
 * Shows backup/reload settings according to access role and reload availability.
 *
 * @returns {void}
 */
function updateEventData() {
  const coach = accessRole() === "coach";
  get("backup-hint").hidden = !coach;
  get("settings-event-data").hidden = !coach && get("reload-shared").hidden;
}
/**
 * Exposes the correct local/shared reload action and its containing settings section.
 *
 * @returns {void}
 */
function showReload() {
  get("reload-shared").hidden = false;
  get("reload-shared").textContent = globalThis.EventStorage.shared
    ? "Reload shared data"
    : "Reload saved event";
  updateEventData();
}
globalThis.EventStorage.onexternalchange = () => {
  if (!storageReady) return;
  showReload();
  notify(
    "This event was changed in another browser tab. Use Settings > Reload saved event before making changes here; saves from this tab will be refused to protect the newer scores.",
  );
};
// auto: a background refresh while nothing is being edited; it keeps the selected match, team, and review.
/**
 * Loads, validates, adopts, renders, and optionally persists the latest event.
 *
 * @param {boolean} [auto=false] - Background refresh preserves selection and focus;
 *   an explicit reload discards drafts.
 * @returns {Promise<void>}
 */
async function reloadEvent(auto = false) {
  const where = globalThis.EventStorage.shared ? "shared" : "saved";
  const keep = { selected: state.selected, phase: state.selectedPhase, focus: document.activeElement?.id };
  document.querySelector("main").inert = true;
  document.querySelector(".topbar").inert = true;
  try {
    const stored = await globalThis.EventStorage.load();
    const { next, from } =
      stored === undefined ? { next: emptyState(), from: null } : adoptGame(validateState(stored));
    state = next;
    dirty = false;
    unsaved = false;
    staleNotice = false;
    if (auto) {
      state.selectedPhase = keep.phase;
      state.selected = keep.selected;
    } else {
      rosterSort = null;
      resetTeamEditor();
      globalThis.SkillsUI?.reset();
      globalThis.PracticeUI?.reset();
      globalThis.RubricUI?.reset();
      globalThis.InterviewUI?.reset();
    }
    render();
    applyAccess();
    if (auto) globalThis.SkillsUI?.discard();
    if (activeMatches().length) loadMatch(currentMatch() ? state.selected : activeMatches()[0].id, false);
    else get("save-state").textContent = "";
    document.querySelector("main").inert = false;
    get("reload-shared").hidden = true;
    updateEventData();
    if (auto) {
      if (keep.focus) document.getElementById(keep.focus)?.focus({ preventScroll: true });
      if (get("notice-message").textContent.startsWith("Newer shared scores")) get("notice").hidden = true;
      get("save-state").textContent =
        `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    } else
      notify(
        from ? `Latest ${where} event loaded. ${rolloverMessage(from)}` : `Latest ${where} event loaded.`,
      );
    if (from && !globalThis.EventStorage.readOnly) await persist();
  } catch (error) {
    notify(`Reload failed: ${error.message} Your in-memory event is still available for export.`);
  } finally {
    document.querySelector(".topbar").inert = false;
  }
}
get("reload-shared").addEventListener("click", async () => {
  const where = globalThis.EventStorage.shared ? "shared" : "saved";
  if (
    !globalThis.EventStorage.readOnly &&
    (!idle() ||
      !(await ask(
        `Reload the latest ${where} event?${backupAdvice(" Export a backup first:")} Pending scores and unposted edits will be discarded.`,
        "Reload",
        true,
      )))
  )
    return;
  reloadEvent();
});

// Shared app: check for scores saved elsewhere every few seconds while the page is visible. When nothing is being
// edited the page refreshes itself; otherwise a notice offers the reload so in-progress work is never discarded.
const SYNC_MS = 10000;
let staleNotice = false;
let syncing = false;
/**
 * Returns whether the page has no drafts, focused edits, active timers, dialogs, or pending save.
 *
 * @returns {boolean}
 */
function editingNothing() {
  const focused = document.activeElement;
  const typing = focused?.matches?.(
    "textarea, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range])",
  );
  const drafted = [
    ...document.querySelectorAll(
      "#team-form input, #access-form input, #robot-form input, #robot-form textarea",
    ),
  ].some((field) => field.value.trim() && !field.readOnly && field.type !== "datetime-local");
  return (
    !dirty &&
    !unsaved &&
    deadline === null &&
    !globalThis.TimerAudio.isStarting() &&
    !globalThis.SkillsUI?.isDirty() &&
    !globalThis.SkillsUI?.isRunning() &&
    !globalThis.PracticeUI?.isDirty() &&
    !globalThis.PracticeUI?.isRunning() &&
    !globalThis.RubricUI?.isDirty() &&
    !globalThis.InterviewUI?.isDirty() &&
    !document.body.classList.contains("flow-open") &&
    !document.querySelector("dialog[open]:not(#settings-tray)") &&
    editingTeam === null &&
    !typing &&
    !drafted
  );
}
/**
 * Polls the shared revision and refreshes safely or prompts before discarding active edits.
 *
 * @returns {Promise<void>}
 */
async function syncShared() {
  if (
    syncing ||
    !storageReady ||
    document.hidden ||
    globalThis.EventStorage.conflicted ||
    !globalThis.EventStorage.hasNewer
  )
    return;
  syncing = true;
  try {
    if (!(await globalThis.EventStorage.hasNewer())) return;
    if (editingNothing()) await reloadEvent(true);
    else if (!staleNotice) {
      staleNotice = true;
      showReload();
      notify(
        "Newer shared scores are available. Finish or discard what you're editing; the page updates automatically once nothing is in progress, or use Settings > Reload shared data now.",
      );
    }
  } catch {
    /* A missed check is retried on the next interval. */
  } finally {
    syncing = false;
  }
}
if (globalThis.EventStorage.shared) {
  setInterval(syncShared, SYNC_MS);
  document.addEventListener("visibilitychange", syncShared);
}
window.addEventListener("beforeunload", (event) => {
  if (
    unsaved ||
    dirty ||
    deadline !== null ||
    globalThis.TimerAudio.isStarting() ||
    globalThis.SkillsUI?.isDirty() ||
    globalThis.SkillsUI?.isRunning() ||
    globalThis.PracticeUI?.isDirty() ||
    globalThis.PracticeUI?.isRunning() ||
    globalThis.RubricUI?.isDirty() ||
    globalThis.InterviewUI?.isDirty()
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});
/**
 * Loads/migrates the event, handles game rollover, and initializes the app UI.
 *
 * @returns {Promise<void>}
 */
async function initializeStorage() {
  document.querySelector(".topbar").inert = true;
  document.querySelector(".tabs").inert = true;
  get("save-state").textContent = "Loading saved event...";
  try {
    const stored = await globalThis.EventStorage.load();
    if (stored !== undefined) state = validateState(stored);
    else if (!globalThis.EventStorage.shared) {
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy) {
        state = validateState(JSON.parse(legacy));
        await globalThis.EventStorage.save(state);
        notify(
          "Your saved event and score history have been migrated to IndexedDB. The original local-storage copy has been kept for recovery.",
        );
      }
    }
    storageReady = true;
    get("save-state").textContent = "";
    const { next, from } = adoptGame(state);
    if (from) {
      state = next;
      if (!globalThis.EventStorage.readOnly && (await persist())) notify(rolloverMessage(from));
    }
    render();
    applyAccess();
    if (globalThis.EventStorage.readOnly) notify(readOnlyMessage());
    if (activeMatches().length) {
      loadMatch(state.selected || activeMatches()[0].id, false);
      if (tabNames().has("control")) tab("control", false);
    }
    document.querySelector("main").inert = false;
    /**
     * Restores a valid tab from the current URL hash.
     *
     * @param {string} name URL hash tab name.
     * @returns {void} Updates the selected tab and browser history.
     */
    const restore = (name) => {
      if (tabNames().has(name)) tab(name, false);
      setupHistory();
    };
    if (globalThis.google?.script?.url)
      globalThis.google.script.url.getLocation((location) => restore(location.hash));
    else restore(decodeURIComponent(location.hash.slice(1)));
  } catch (error) {
    get("save-state").textContent = "Storage unavailable";
    notify(
      `Saved data could not be loaded: ${error.message} Existing data has not been overwritten. Reload to retry; event editing is disabled to protect saved scores.`,
    );
  } finally {
    document.querySelector(".tabs").inert = !storageReady;
    document.querySelector(".topbar").inert = !storageReady;
  }
}
// Fills game-specific labels, links, and limits in the page from the active game definition.
/**
 * Applies active-game labels, links, practice-only visibility, and timer limits to the page.
 *
 * @returns {void}
 */
function applyGame() {
  const { name, program, season, manual, fieldImage } = ACTIVE_GAME;
  document.body.classList.toggle("practice-only", ACTIVE_GAME.practiceOnly === true);
  document.title = `${name} | ${document.title}`;
  document.querySelector('[data-tab="analysis"]').textContent = ACTIVE_GAME.practiceOnly
    ? "Analysis"
    : "Cumulative leaderboard";
  document.querySelector("#analysis-view .section-heading h2").textContent = ACTIVE_GAME.practiceOnly
    ? "Team analysis"
    : "Cumulative leaderboard";
  const accessPermissionsNote =
    ACTIVE_GAME.program === "VEX V5"
      ? [
          "Everyone listed here has the same editing permissions, including access management.",
          "Other signed-in users can view results only.",
          "Changes take effect the next time a person opens or saves.",
        ].join(" ")
      : [
          "Coaches can use all parts of the app.",
          "Team members can save practice runs, view leaderboards, and review any team's notebook or interview.",
          "They can read feedback for their team and reviews they wrote, and edit or delete only their own student reviews.",
          "Only coach reviews count toward the Cumulative leaderboard.",
          "Other visitors can view results only.",
        ].join(" ");
  get("access-permissions-note").textContent = accessPermissionsNote;
  get("settings-access-hint").textContent =
    ACTIVE_GAME.program === "VEX V5"
      ? "Add or remove the Google accounts that can edit this app. Every listed account has the same access."
      : "Choose who can score as a coach or team member.";
  document.querySelectorAll("[data-game-name]").forEach((element) => {
    element.textContent = element.closest(".brand") ? name.toUpperCase() : name;
  });
  document.querySelector(".brand small").textContent = ACTIVE_GAME.brandLabel || "LOCAL MATCH MANAGER";
  document.querySelector("[data-game-disclaimer]").textContent =
    ACTIVE_GAME.disclaimer || "Created for North Union Vex IQ. Not an official VEX tool.";
  document.querySelectorAll("[data-game-season]").forEach((element) => {
    element.textContent = `${program} / ${season}`;
  });
  document.querySelectorAll("[data-game-manual]").forEach((link) => {
    link.href = manual.url;
    link.textContent = `${manual.label} \u2197`;
  });
  document.querySelectorAll("[data-game-rule]").forEach((link) => {
    const rule = manual.rules[link.dataset.gameRule];
    if (rule) link.href = `${manual.url}#${rule.anchor}`;
  });
  document.querySelectorAll("[data-game-rule-label]").forEach((element) => {
    const rule = manual.rules[element.dataset.gameRuleLabel];
    if (rule) element.textContent = rule.label;
  });
  document.querySelectorAll("[data-game-field]").forEach((image) => {
    if (fieldImage) {
      if (!image.getAttribute("src").startsWith("data:")) image.src = fieldImage;
      image.alt = `${name} game field`;
    } else image.hidden = true;
  });
  document.querySelectorAll("[data-game-seconds]").forEach((input) => {
    input.max = MATCH_MS / 1000;
  });
  document.querySelectorAll("[data-game-clock]").forEach((output) => {
    output.textContent = clockText(MATCH_MS);
  });
  if (ACTIVE_GAME.practiceOnly) {
    const setupTab = document.querySelector('[data-tab="setup"]');
    setupTab.childNodes[0].textContent = "Teams ";
    get("practice-team-field").firstChild.textContent = "Red team";
    get("practice-partner-field").firstChild.textContent = "Red partner";
    get("practice-view").querySelector("h2").textContent = "Practice";
    get("practice-view").querySelector(".eyebrow").textContent = "VEX V5 PRACTICE";
    get("practice-intro-note").textContent =
      "Run solo Driver or Autonomous Skills practice, or a paired Teamwork practice run. Record field results after each run.";
    get("practice-history-note").textContent =
      "Latest 100 saved practice runs. Teamwork runs record both teams; Skills runs record one team. Student-entered runs are labeled in the history.";
    document.querySelector("#setup-view .schedule-builder").hidden = true;
    get("practice-bag-total").hidden = true;
    get("practice-mode")
      .querySelectorAll("option")
      .forEach((option) => {
        option.hidden = !ACTIVE_GAME.practice?.modes.includes(option.value);
      });
    get("settings-event-data").querySelector(".settings-heading").textContent = "Practice data";
    get("backup-hint").textContent = "Backups include the team roster, practice runs, and reviews.";
  }
}
applyGame();
initializeStorage();
