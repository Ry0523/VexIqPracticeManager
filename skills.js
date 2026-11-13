/** Skills-attempt UI: attempt selection, eligibility, Stop Time, and timer-driven posting. */
(function () {
  "use strict";
  /**
   * @type {{team: import("./types").TeamId|null, mode: "driver"|"autonomous", attempt: 1|2|3}}
   */
  let selection = { team: null, mode: "driver", attempt: 1 };
  let skillDraft = null;
  let changed = false;
  let endAt = null;
  let timeLeft = MATCH_MS;
  let ended = false;
  let started = false;
  let paused = false;
  let flowWatch = null;
  const calculator = get("skills-scoring-inputs");
  const form = get("skills-form");
  const timerStage = get("skills-timer-stage");
  const eligibility = get("skills-eligibility");
  const attemptLog = get("skills-attempt-log");
  timerStage.querySelector(".timer-actions")?.remove();
  const runLayout = document.createElement("div");
  runLayout.className = "skills-run-layout";
  const runPanel = document.createElement("div");
  runPanel.className = "skills-run-panel";
  const scorePanel = document.createElement("div");
  scorePanel.className = "skills-score-panel";
  const attemptHeader = get("skills-attempt-header");
  const resultFields = form.querySelector(".skills-result-fields");
  resultFields.id = "skills-result-fields";
  const scoreHeading = form.querySelector(".section-heading");
  const scoreTotal = form.querySelector(".score-total");
  const scoreActions = form.querySelector(".score-actions");
  runPanel.append(attemptLog, eligibility, attemptHeader, resultFields, timerStage);
  scorePanel.append(scoreHeading, scoreTotal, calculator, scoreActions);
  runLayout.append(runPanel, scorePanel);
  form.replaceChildren(runLayout);
  const fullscreenButton = document.createElement("button");
  fullscreenButton.id = "skills-fullscreen";
  fullscreenButton.type = "button";
  fullscreenButton.title = "Full-screen skills run";
  fullscreenButton.setAttribute("aria-label", "Full-screen skills run");
  fullscreenButton.textContent = "\u26F6";
  timerStage.append(fullscreenButton);
  /**
   * User-facing mode label.
   *
   * @param {"driver"|"autonomous"} mode - Skills mode.
   * @returns {string} User-facing mode label.
   */
  const modeName = (mode) => (mode === "driver" ? "Driver" : "Autonomous");
  /**
   * Saved entry for the selected team/mode/attempt slot.
   *
   * @returns {import("./types").SkillsAttempt|undefined} Saved entry for the selected team/mode/attempt slot.
   */
  const record = () =>
    state.skills.find(
      (entry) =>
        entry.team === selection.team && entry.mode === selection.mode && entry.attempt === selection.attempt,
    );
  /**
   * Returns whether the team is in the event schedule or Skills-only event.
   *
   * @param {import("./types").TeamId} team - Team ID.
   * @returns {boolean} Whether the team is in the event schedule or Skills-only event.
   */
  const scheduled = (team) => state.skillsOnly || state.matches.some((match) => match.teams.includes(team));
  /**
   * Returns whether the team has a non-no-show qualification result, or the event is Skills-only.
   *
   * @param {import("./types").TeamId} team - Team ID.
   * @returns {boolean} Whether the team has a non-no-show qualification result, or the event is Skills-only.
   */
  const participated = (team) =>
    state.skillsOnly ||
    state.matches.some(
      (match) => match.teams.includes(team) && match.result && match.result.statuses[team] !== "absent",
    );
  /**
   * Returns score, or zero for DQ/forfeit.
   *
   * @param {import("./types").SkillsAttempt} entry - Skills result.
   * @returns {number} Score, or zero for DQ/forfeit.
   */
  const effectiveScore = (entry) => (entry.status === "ok" ? Core.score(entry.counts) : 0);
  /**
   * Skills eligibility status shown in the UI.
   *
   * @param {import("./types").TeamId} team - Team ID.
   * @returns {string} Skills eligibility status shown in the UI.
   */
  const admission = (team) =>
    state.skillsOnly
      ? "Skills-only event"
      : participated(team)
        ? "Confirmed"
        : scheduled(team)
          ? "Pending qualification"
          : "Not scheduled";

  /**
   * Returns whether pending attempt edits may be discarded to switch slots.
   *
   * @returns {Promise<boolean>} Whether pending attempt edits may be discarded to switch slots.
   */
  async function canSwitch() {
    if (!idle()) return false;
    return !(changed || paused) || (await ask("Discard this unposted skills score?", "Discard score", true));
  }

  /**
   * Loads the selected attempt or initializes an empty draft and updates the UI.
   *
   * @returns {void} Loads the selected attempt or initializes an empty draft and updates the UI.
   */
  function loadSlot() {
    const saved = record();
    skillDraft = saved
      ? JSON.parse(JSON.stringify(saved))
      : { counts: Core.emptyCounts(), goals: ACTIVE_GAME.emptyGoals() };
    skillDraft.goals = skillDraft.goals || Core.goalsFromCounts(skillDraft.counts);
    changed = false;
    endAt = null;
    timeLeft = MATCH_MS;
    ended = false;
    started = false;
    paused = false;
    get("skills-opt-in").checked = saved?.optIn || false;
    get("skills-stop-time").value = saved?.stopTime || 0;
    get("skills-status").value = saved?.status || "ok";
    renderScoringInputs(calculator, skillDraft, "skills-goal");
    renderSkills();
    updateClock();
  }

  /**
   * Validates the draft and updates score, Stop Time, and posting controls.
   *
   * @returns {void} Validates the draft and updates score, Stop Time, and posting controls.
   */
  function updateScoreEntry() {
    if (!skillDraft) return;
    const valid = updateCalculator(
      calculator,
      skillDraft,
      get("skills-score-total"),
      get("skills-bag-total"),
    );
    const optIn = get("skills-opt-in").checked;
    const status = get("skills-status").value;
    if (!optIn || status !== "ok") get("skills-stop-time").value = 0;
    const stop = Number(get("skills-stop-time").value);
    const validStop =
      get("skills-stop-time").value !== "" && Number.isInteger(stop) && stop >= 0 && stop <= MATCH_MS / 1000;
    get("skills-stop-time").disabled = !optIn || status !== "ok" || endAt !== null || (started && !ended);
    get("skills-opt-in").disabled = started;
    if (valid && status !== "ok") get("skills-score-total").textContent = "0";
    // Team members can post an unused attempt but cannot update or void a posted one.
    const memberLocked = isMember() && Boolean(record());
    get("save-skills").disabled =
      !valid ||
      !validStop ||
      !scheduled(selection.team) ||
      memberLocked ||
      endAt !== null ||
      (started && !ended) ||
      deadline !== null ||
      globalThis.TimerAudio.isStarting();
    get("save-skills").hidden = memberLocked;
    calculator.inert = memberLocked;
    get("skills-status").disabled = memberLocked;
    if (memberLocked) {
      get("skills-opt-in").disabled = true;
      get("skills-stop-time").disabled = true;
    }
    get("reset-skills-score").disabled = memberLocked;
    get("skills-only").disabled = isMember();
  }

  /**
   * Returns whether the stopped Skills timer can be reset.
   *
   * @returns {boolean} Whether the stopped Skills timer can be reset.
   */
  const canResetClock = () =>
    endAt === null && (ended || timeLeft !== MATCH_MS) && !globalThis.TimerAudio.isStarting();
  /**
   * Returns whether Skills is in its fullscreen flow.
   *
   * @returns {boolean} Whether Skills is in its fullscreen flow.
   */
  const flowOpen = () => get("skills-view").classList.contains("skills-flow-mode");

  /**
   * Opens fullscreen flow for the selected team and attempt.
   *
   * @returns {Promise<void>} Opens fullscreen flow for the selected team and attempt.
   */
  async function enterFlow() {
    if (flowOpen() || !selection.team) return;
    get("skills-view").classList.add("skills-flow-mode");
    document.body.classList.add("flow-open");
    syncScreenWakeLock();
    get("skills-flow-label").textContent =
      `${selection.team} / ${teamName(selection.team)} / ${modeName(selection.mode)} / Attempt ${selection.attempt} of 3`;
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement)
        await document.documentElement.requestFullscreen();
    } catch {
      /* The full-screen layout remains available if the browser blocks fullscreen. */
    }
    clearInterval(flowWatch);
    if (document.fullscreenElement)
      flowWatch = setInterval(() => {
        if (!document.fullscreenElement) exitFlow();
      }, 500);
  }

  /**
   * Closes fullscreen Skills flow and releases its wake-lock demand.
   *
   * @returns {void} Closes fullscreen Skills flow and releases its wake-lock demand.
   */
  function exitFlow() {
    if (!flowOpen()) return;
    get("skills-view").classList.remove("skills-flow-mode");
    document.body.classList.remove("flow-open");
    syncScreenWakeLock();
    clearInterval(flowWatch);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) exitFlow();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      flowOpen() &&
      !document.fullscreenElement &&
      !document.querySelector("dialog[open]")
    )
      exitFlow();
  });

  /**
   * Updates the timer, phase labels, controls, and score validity.
   *
   * @returns {void} Updates the timer, phase labels, controls, and score validity.
   */
  function updateClock() {
    syncScreenWakeLock();
    const seconds = Math.ceil(Math.min(MATCH_MS, timeLeft) / 1000);
    const driving = selection.mode === "driver";
    const preparing = globalThis.TimerAudio.isStarting() || (endAt !== null && timeLeft > MATCH_MS);
    const controlState = ended
      ? "ended"
      : preparing
        ? "preparing"
        : endAt !== null
          ? "running"
          : paused
            ? "paused"
            : "ready";
    get("skills-flow-label").textContent = selection.team
      ? `${selection.team} / ${teamName(selection.team)} · ${modeName(selection.mode)} / Attempt ${selection.attempt} of 3`
      : "Skills run";
    get("skills-timer").textContent = clockText(timeLeft);
    get("skills-timer-dial").style.setProperty("--timer-progress-angle", timerProgressAngle(timeLeft));
    get("skills-timer-label").textContent = ended
      ? "SKILLS RUN ENDED"
      : preparing
        ? "PREPARING TIMER"
        : paused
          ? "SKILLS RUN PAUSED"
          : endAt !== null
            ? driving && inSwitchWindow(seconds * 1000)
              ? "DRIVER SWITCH WINDOW"
              : "SKILLS RUN IN PROGRESS"
            : "READY FOR SKILLS";
    if (timeLeft > MATCH_MS && get("timer-countdown").checked)
      get("skills-timer-label").textContent =
        `STARTING IN ${globalThis.TimerAudio.countdownNumber(timeLeft - MATCH_MS)}`;
    get("skills-timer-stage").classList.toggle("ended", ended);
    const controls = get("skills-run-controls");
    controls.dataset.state = controlState;
    const reset = get("reset-skills-timer");
    reset.hidden = !["paused", "ended"].includes(controlState);
    reset.setAttribute("aria-label", controlState === "paused" ? "Reset paused run" : "Reset timer");
    reset.title = controlState === "paused" ? "Reset paused run" : "Reset timer";
    reset.querySelector(".run-cancel-icon").toggleAttribute("hidden", controlState !== "paused");
    reset.querySelector(".run-reset-icon").toggleAttribute("hidden", controlState !== "ended");
    get("start-skills").hidden = !["ready", "paused"].includes(controlState);
    get("start-skills").setAttribute("aria-label", controlState === "paused" ? "Resume run" : "Start run");
    get("start-skills").title = controlState === "paused" ? "Resume run" : "Start run";
    get("start-skills").disabled =
      !["ready", "paused"].includes(controlState) ||
      !selection.team ||
      !scheduled(selection.team) ||
      Boolean(record()) ||
      globalThis.TimerAudio.isStarting();
    get("pause-skills").hidden = controlState !== "running";
    get("stop-skills").hidden = !["running", "preparing"].includes(controlState);
    get("stop-skills").disabled = globalThis.TimerAudio.isStarting();
    get("reset-skills-timer").disabled = !canResetClock();
    get("skills-fullscreen").disabled = !selection.team;
    updateScoreEntry();
  }

  /**
   * Renders active-event and all-time Skills rankings.
   *
   * @returns {void} Renders active-event and all-time Skills rankings.
   */
  function renderLeaderboard() {
    get("skills-event-rankings").hidden = !state.matches.length && !state.skillsOnly && !state.skills.length;
    const seasonRecords = seasonHistory();
    const allTime = History.skillsRanking(
      seasonRecords,
      state.teams,
      History.currentRobotOnly(seasonRecords, state.robots),
    );
    get("skills-all-time").innerHTML =
      allTime
        .map(
          (row) =>
            `<tr><td>${row.rank ?? "--"}</td><td>${escapeText(row.id)}</td><td>${escapeText(row.name)}</td><td>${row.entered ? row.driver : "--"}</td><td>${escapeText(row.driverDate)}</td><td>${row.entered ? row.autonomous : "--"}</td><td>${escapeText(row.autonomousDate)}</td><td><strong>${row.entered ? row.total : "--"}</strong></td></tr>`,
        )
        .join("") || '<tr><td colspan="8">No teams or saved skills results.</td></tr>';
    const eligible = state.teams.filter((team) => participated(team.id)).map((team) => team.id);
    const rows = Core.skillsStandings(state.teams, state.skills, eligible);
    /**
     * Renders the three recorded attempt slots for one Skills mode.
     *
     * @param {import("./types").SkillsStandingAttempt[]} entries Mode attempts for one team.
     * @returns {string} Attempt summary markup.
     */
    const attemptsText = (entries) =>
      [1, 2, 3]
        .map((attempt) => {
          const entry = entries.find((item) => item.attempt === attempt);
          return `<span class="skill-history" title="Attempt ${attempt}${entry ? ` / ${entry.status} / Stop ${entry.stop}s` : " / Unrecorded"}">${attempt}: ${entry ? `${entry.value}${entry.status === "ok" ? "" : entry.status === "dq" ? " DQ" : " F"}` : "--"}</span>`;
        })
        .join("");
    get("skills-standings").innerHTML = rows.length
      ? rows
          .map(
            (row) =>
              `<tr><td>${row.rank ?? "--"}</td><td><strong>${escapeText(row.id)}</strong><small>${escapeText(row.name)}</small></td><td>${row.bestDriver}</td><td>${row.bestAuto}</td><td class="skills-combined">${row.total}</td><td>${attemptsText(row.modes.driver)}</td><td>${attemptsText(row.modes.autonomous)}</td><td>${row.driverStop}s / ${row.autoStop}s</td><td>${admission(row.id)}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="9">No teams registered.</td></tr>';
    get("skills-mini-standings").innerHTML = rows.length
      ? rows
          .map(
            (row) =>
              `<div class="mini-row ${row.id === selection.team ? "skills-standing-selected" : ""}"><span>${row.rank ?? "--"}</span><div><b>${escapeText(row.id)}</b><small>${escapeText(row.name)}</small><small>Driver ${row.bestDriver} / Auto ${row.bestAuto}</small>${!row.eligible && row.entered ? `<small>${admission(row.id)}</small>` : ""}</div><strong>${row.entered ? row.total : "--"}</strong></div>`,
          )
          .join("")
      : '<p class="empty">No teams registered.</p>';
  }

  /**
   * Renders the Skills workspace for the selected team and attempt.
   *
   * @returns {void} Renders the Skills workspace for the selected team and attempt.
   */
  function renderSkills() {
    const previousTeam = selection.team;
    if (!state.teams.some((team) => team.id === selection.team)) selection.team = state.teams[0]?.id || null;
    get("skills-team-count").textContent = state.teams.length;
    get("skills-team-list").innerHTML = state.teams.length
      ? state.teams
          .map((team) => {
            const entries = state.skills.filter((entry) => entry.team === team.id);
            const active = selection.team === team.id;
            return `<button type="button" class="match-choice skills-team-choice ${active ? "active" : ""}" data-skills-team="${escapeText(team.id)}" aria-label="Select skills team ${escapeText(team.id)}" aria-pressed="${active}"><span>Driver ${entries.filter((entry) => entry.mode === "driver").length} / 3<small>Auto ${entries.filter((entry) => entry.mode === "autonomous").length} / 3</small></span><b>${escapeText(team.id)}</b><small class="skills-team-name">${escapeText(team.name)}</small></button>`;
          })
          .join("")
      : '<p class="empty">No teams registered.</p>';
    get("skills-selected-team").innerHTML = selection.team
      ? `<b>${escapeText(selection.team)}</b><span>${escapeText(teamName(selection.team))}</span>`
      : "";
    get("skills-only").checked = state.skillsOnly;
    get("skills-empty").hidden = Boolean(selection.team);
    get("skills-workspace").hidden = !selection.team;
    const teamAttempts = state.skills.filter((entry) => entry.team === selection.team);
    get("skills-progress").textContent = `${teamAttempts.length} / 6 recorded`;
    get("skills-eligibility").textContent = selection.team ? admission(selection.team) : "No team selected";
    get("skills-attempt-log").innerHTML = ["driver", "autonomous"]
      .map(
        (mode) =>
          `<div class="skills-log-mode"><h3>${modeName(mode)} <small>${teamAttempts.filter((entry) => entry.mode === mode).length} / 3</small></h3><div class="skills-slot-buttons">${[
            1, 2, 3,
          ]
            .map((attempt) => {
              const entry = teamAttempts.find((item) => item.mode === mode && item.attempt === attempt);
              const active = selection.mode === mode && selection.attempt === attempt;
              return `<button type="button" data-open-skills-mode="${mode}" data-open-skills-attempt="${attempt}" aria-label="${modeName(mode)} attempt ${attempt}" aria-pressed="${active}" ${!selection.team ? "disabled" : ""}>${attempt}<strong>${entry ? `${effectiveScore(entry)} pts` : "--"}</strong></button>`;
            })
            .join("")}</div></div>`,
      )
      .join("");
    renderLeaderboard();
    if (!selection.team) {
      skillDraft = null;
      changed = false;
      return;
    }
    if (!skillDraft || selection.team !== previousTeam) {
      loadSlot();
      return;
    }
    const saved = record();
    get("skills-heading").textContent = `${modeName(selection.mode)} / Attempt ${selection.attempt} of 3`;
    get("skills-posted").textContent = saved ? "Posted" : "Unrecorded";
    get("void-skills").hidden = !saved || isMember();
    get("save-skills").textContent = saved ? "Update skills score" : "Post skills score";
    updateClock();
  }

  /**
   * Selects the first team/Driver attempt and clears the current draft.
   *
   * @returns {void} Selects the first team/Driver attempt and clears the current draft.
   */
  function reset() {
    selection = { team: state.teams[0]?.id || null, mode: "driver", attempt: 1 };
    skillDraft = null;
    changed = false;
    endAt = null;
    timeLeft = MATCH_MS;
    ended = false;
    started = false;
    renderSkills();
  }

  get("skills-team-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-skills-team]");
    if (!button || button.dataset.skillsTeam === selection.team || !(await canSwitch())) return;
    selection.team = button.dataset.skillsTeam;
    selection.attempt = 1;
    loadSlot();
    [...get("skills-team-list").querySelectorAll("[data-skills-team]")]
      .find((item) => item.dataset.skillsTeam === selection.team)
      ?.focus();
  });
  get("skills-attempt-log").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-open-skills-mode]");
    if (!button || !(await canSwitch())) return;
    selection.mode = button.dataset.openSkillsMode;
    selection.attempt = Number(button.dataset.openSkillsAttempt);
    loadSlot();
  });
  get("skills-only").addEventListener("change", async (event) => {
    if (!idle()) {
      event.target.checked = state.skillsOnly;
      return;
    }
    const unranked = event.target.checked
      ? []
      : [...new Set(state.skills.map((entry) => entry.team))].filter(
          (team) => !state.matches.some((match) => match.teams.includes(team)),
        );
    if (
      unranked.length &&
      !(await ask(
        `Turn off Skills-only event? ${unranked.join(", ")} ${unranked.length === 1 ? "is" : "are"} not scheduled in qualifications, so their recorded attempts will no longer be ranked (T15).`,
        "Turn off",
        true,
      ))
    ) {
      event.target.checked = true;
      return;
    }
    state.skillsOnly = event.target.checked;
    persist();
    renderSkills();
  });
  get("skills-form").addEventListener("input", () => {
    changed = true;
    updateScoreEntry();
  });
  calculator.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (!button || button.disabled) return;
    const input = get(button.dataset.counter);
    input.value = Number(input.value) + Number(button.dataset.step);
    changed = true;
    updateScoreEntry();
  });
  get("reset-skills-score").addEventListener("click", async () => {
    if (
      !(await ask(
        "Reset the skills draft bag counts? Posted attempts will not be changed until you post an update.",
        "Reset counts",
        true,
      ))
    )
      return;
    skillDraft.goals = ACTIVE_GAME.emptyGoals();
    renderScoringInputs(calculator, skillDraft, "skills-goal");
    changed = true;
    updateScoreEntry();
  });
  get("skills-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!idle() || !selection.team) return;
    try {
      if (!scheduled(selection.team))
        throw new Error(
          "Schedule this team in qualifications, or select Skills-only event, before recording attempts (T15).",
        );
      const status = get("skills-status").value;
      const optIn = get("skills-opt-in").checked;
      const entry = {
        ...selection,
        counts: Core.goalCounts(skillDraft.goals),
        goals: JSON.parse(JSON.stringify(skillDraft.goals)),
        status,
        optIn,
        stopTime: status === "ok" && optIn ? Number(get("skills-stop-time").value) : 0,
      };
      entry.resultId = record()?.resultId || History.skillKey(state.sessionId, entry);
      const updated = Core.saveSkillAttempt(state.teams, state.skills, entry);
      if (
        record() &&
        !(await ask(
          "Replace this posted skills attempt? This will not create an extra attempt.",
          "Replace attempt",
        ))
      )
        return;
      const saving = saveResultChange(
        { ...state, skills: updated },
        "skills",
        entry,
        record() ? "updated" : "posted",
      );
      changed = false;
      render();
      loadSlot();
      if (await saving)
        notify(
          `${selection.team} ${modeName(selection.mode)} attempt ${selection.attempt} posted: ${effectiveScore(entry)} points. Score history saved.`,
        );
    } catch (error) {
      notify(error.message);
    }
  });
  get("void-skills").addEventListener("click", async () => {
    if (
      isMember() ||
      !idle() ||
      !(await ask(
        `Void this attempt for a correction or authorized replay? It will be removed and its slot will become unused.${changed ? " Your unposted edits to this attempt will also be discarded." : ""}`,
        "Void attempt",
        true,
      ))
    )
      return;
    const entry = record();
    if (!entry) return;
    saveResultChange(
      { ...state, skills: state.skills.filter((item) => item !== entry) },
      "skills",
      entry,
      "voided",
    );
    changed = false;
    render();
    loadSlot();
  });
  get("next-skills").addEventListener("click", async () => {
    if (!(await canSwitch())) return;
    for (const mode of [selection.mode, selection.mode === "driver" ? "autonomous" : "driver"]) {
      const attempt = [1, 2, 3].find(
        (slot) =>
          !state.skills.some(
            (entry) => entry.team === selection.team && entry.mode === mode && entry.attempt === slot,
          ),
      );
      if (attempt) {
        selection.mode = mode;
        selection.attempt = attempt;
        loadSlot();
        return;
      }
    }
    notify("All three driver and three autonomous attempts have been recorded for this team.");
  });
  get("skills-fullscreen").addEventListener("click", enterFlow);
  get("skills-flow-exit").addEventListener("click", exitFlow);
  get("start-skills").addEventListener("click", async () => {
    if (globalThis.TimerAudio.isStarting()) {
      notify("Wait for the timer audio to become ready.");
      return;
    }
    if (endAt !== null || !idle() || ended || record() || !scheduled(selection.team)) return;
    const fresh = !started;
    started = true;
    paused = false;
    const ready = globalThis.TimerAudio.start(timeLeft, fresh, selection.mode === "driver");
    updateClock();
    endAt = await ready;
    if (endAt !== null) timeLeft = Math.max(0, endAt - globalThis.TimerAudio.now());
    updateClock();
  });
  get("pause-skills").addEventListener("click", () => {
    if (endAt === null || globalThis.TimerAudio.isStarting() || timeLeft > MATCH_MS) return;
    timeLeft = Math.max(0, endAt - globalThis.TimerAudio.now());
    endAt = null;
    if (timeLeft === 0) {
      ended = true;
      get("skills-stop-time").value = 0;
      changed = true;
      globalThis.TimerAudio.finish();
    } else {
      paused = true;
      globalThis.TimerAudio.stop();
    }
    updateClock();
  });
  get("stop-skills").addEventListener("click", () => {
    if (globalThis.TimerAudio.isStarting()) {
      globalThis.TimerAudio.stop();
      endAt = null;
      timeLeft = MATCH_MS;
      started = false;
      paused = false;
      ended = false;
      updateClock();
      return;
    }
    if (endAt === null) return;
    const remaining = Math.max(0, endAt - globalThis.TimerAudio.now());
    if (remaining > MATCH_MS) {
      globalThis.TimerAudio.stop();
      endAt = null;
      timeLeft = MATCH_MS;
      started = false;
      paused = false;
      ended = false;
      get("skills-stop-time").value = 0;
      updateClock();
      return;
    }
    timeLeft = remaining;
    endAt = null;
    ended = true;
    paused = false;
    get("skills-stop-time").value = get("skills-opt-in").checked ? Math.ceil(timeLeft / 1000) : 0;
    changed = true;
    globalThis.TimerAudio.finish();
    updateClock();
  });
  get("reset-skills-timer").addEventListener("click", () => {
    if (!canResetClock()) return;
    endAt = null;
    timeLeft = MATCH_MS;
    ended = false;
    started = false;
    paused = false;
    get("skills-stop-time").value = 0;
    changed = true;
    updateClock();
  });
  setInterval(() => {
    if (endAt === null) return;
    timeLeft = Math.max(0, endAt - globalThis.TimerAudio.now());
    if (timeLeft === 0) {
      endAt = null;
      ended = true;
      get("skills-stop-time").value = 0;
      changed = true;
    }
    updateClock();
  }, 25);
  /**
   * @type {import("./types").SkillsUIController} Skills lifecycle API consumed by app.js.
   */
  globalThis.SkillsUI = {
    render: renderSkills,
    reset,
    discard: () => {
      if (selection.team) loadSlot();
    },
    isDirty: () => changed || paused,
    isRunning: () => endAt !== null,
  };
  reset();
})();
