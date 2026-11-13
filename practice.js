/** Shared practice-run controller: teams, timer lifecycle, draft/save flow, and history UI. */
(function () {
  "use strict";
  const calculator = get("practice-scoring-inputs");
  const form = get("practice-form");
  const practiceTiming = Game.timingFor(ACTIVE_GAME);
  const practiceRules = ACTIVE_GAME.practice || null;
  const practiceField = ACTIVE_GAME.practice?.field || null;
  const flowOpen = () => form.classList.contains("flow-mode");
  let flowWatch = null;
  let scoring = { goals: ACTIVE_GAME.emptyGoals() };
  let gameData = null;
  let selected = null;
  let teamContext;
  let practiceTeamTouched = false;
  teamContext = { role: globalThis.EventStorage.access?.role, team: globalThis.EventStorage.access?.team };
  let changed = false;
  let baseline = null;
  let endAt = null;
  let remainingTime = MATCH_MS;
  let started = false;
  let ended = false;
  let teamworkPhase = null;
  let saving = false;
  let runAt = null;
  const modeName = mode => mode === "teamwork" ? "Teamwork" : mode === "driver" ? "Driver skills" : "Autonomous skills";
  const records = () => History.forGame(History.resolve(state.history)).filter(record => record.source === "practice");
  const record = () => records().find(item => item.runId === selected);
  const skillsStatus = () => {
    const saved = record();
    return saved?.kind === "skills" ? saved.value.status : "ok";
  };
  const mode = () => get("practice-mode").value;
  // Game-owned field controls are mounted through a narrow adapter; generic run handling stays here.
  const practiceViewFactory = globalThis.VexGamePracticeViews?.[ACTIVE_GAME.id];
  const practiceView = practiceViewFactory?.({ container: calculator, game: ACTIVE_GAME, escapeText });
  const hasGameField = Boolean(practiceField && practiceView);
  const hasScrimmage = Boolean(practiceRules?.scrimmage);
  const practiceDuration = () => hasScrimmage && mode() === "teamwork" ? teamworkPhase === "driver" || teamworkPhase === "handoff" ? practiceTiming.driverPeriodMs : practiceTiming.autonomousPeriodMs : MATCH_MS;
  const practiceClockText = value => { const seconds = Math.ceil(Math.min(practiceDuration(), value) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };
  const practiceProgressAngle = value => `${((practiceDuration() - Math.max(0, Math.min(practiceDuration(), value))) * 360 / practiceDuration()).toFixed(2)}deg`;
  const isScrimmage = () => hasScrimmage && mode() === "teamwork";
  const participants = () => isScrimmage()
    ? [get("practice-team").value, get("practice-partner").value, get("practice-blue-team").value, get("practice-blue-partner").value]
    : mode() === "teamwork" ? [get("practice-team").value, get("practice-partner").value] : [get("practice-team").value];
  const validParticipants = () => { const ids = participants(); return ids.every(Boolean) && new Set(ids).size === ids.length; };
  const draftSnapshot = () => JSON.stringify({
    fields: [...form.querySelectorAll("input,select,textarea")].map(field => [field.type === "checkbox" ? field.checked : field.value]),
    goals: scoring.goals,
    gameData,
    started,
    ended,
    teamworkPhase,
    runAt
  });
  function captureBaseline() {
    baseline = draftSnapshot();
    changed = false;
  }
  function syncChanged() {
    changed = baseline !== null && draftSnapshot() !== baseline;
  }

  function teamOptions() {
    const directory = new Map((record()?.teams || []).map(team => [team.id, team]));
    for (const team of state.teams) directory.set(team.id, team);
    const access = globalThis.EventStorage.access;
    if (teamContext.role !== access?.role || teamContext.team !== access?.team) {
      teamContext = { role: access?.role, team: access?.team };
      practiceTeamTouched = false;
    }
    const assignedTeam = access?.team || "";
    for (const id of ["practice-team", "practice-partner", "practice-blue-team", "practice-blue-partner"]) {
      if (!get(id)) continue;
      const input = get(id);
      const previous = input.value;
      input.innerHTML = [...directory.values()].map(team => `<option value="${escapeText(team.id)}">${escapeText(team.id)} / ${escapeText(team.name)}</option>`).join("");
      if (id === "practice-team" && !practiceTeamTouched && !selected && directory.has(assignedTeam)) input.value = assignedTeam;
      else if (directory.has(previous)) input.value = previous;
    }
    if (!selected && !changed && get("practice-partner").value === get("practice-team").value && directory.size > 1) get("practice-partner").selectedIndex = 1;
    if (isScrimmage() && !selected && !practiceTeamTouched) {
      const redTeams = new Set([get("practice-team").value, get("practice-partner").value]);
      const available = [...directory.keys()].filter(id => !redTeams.has(id));
      if (!available.includes(get("practice-blue-team").value)) get("practice-blue-team").value = available[0] || "";
      if (!available.includes(get("practice-blue-partner").value) || get("practice-blue-partner").value === get("practice-blue-team").value) get("practice-blue-partner").value = available.find(id => id !== get("practice-blue-team").value) || "";
    }
    return [...directory.values()];
  }

  function renderPracticeScoring() {
    if (hasGameField) practiceView.render({ mode: mode(), data: gameData });
    else renderScoringInputs(calculator, scoring, "practice-goal", mode());
  }

  function update() {
    syncScreenWakeLock();
    const duration = practiceDuration();
    form.hidden = Boolean(globalThis.EventStorage.readOnly);
    const teamwork = mode() === "teamwork";
    const scrimmage = isScrimmage();
    const selectedTeams = participants();
    const teamsReady = validParticipants();
    get("practice-partner-field").hidden = !teamwork;
    get("practice-blue-alliance-fields").hidden = !scrimmage;
    for (const id of ["practice-opt-in-field", "practice-stop-field"]) get(id).hidden = teamwork;
    const stopAllowed = !teamwork && get("practice-opt-in").checked && skillsStatus() === "ok";
    if (!stopAllowed) get("practice-stop").value = 0;
    get("practice-stop").disabled = !stopAllowed || endAt !== null || (started && !ended);
    get("practice-opt-in").disabled = started;
    for (const id of ["practice-mode", "practice-team", "practice-partner", "practice-blue-team", "practice-blue-partner"]) get(id).disabled = endAt !== null || globalThis.TimerAudio.isStarting();
    let valid;
    if (hasGameField) {
      const scoreTotal = get("practice-score-total").closest(".score-total");
      try {
        gameData = practiceView.read(mode());
        const result = practiceField.evaluate(mode(), gameData);
        scoreTotal.hidden = result.kind === "scrimmage";
        if (result.kind === "skills") {
          scoring.goals = ACTIVE_GAME.goalsFromCounts(result.counts);
          get("practice-score-total").textContent = result.score;
        }
        practiceView.update({ mode: mode(), data: gameData, result });
        valid = true;
      } catch {
        valid = false;
        scoreTotal.hidden = scrimmage;
        practiceView.update({ mode: mode(), data: gameData, result: null });
        if (!scrimmage) get("practice-score-total").textContent = "--";
      }
    } else valid = updateCalculator(calculator, scoring, get("practice-score-total"), get("practice-bag-total"));
    get("practice-score-label").textContent = ACTIVE_GAME.practiceOnly ? "Practice score" : teamwork ? "Alliance field score" : "Skills score";
    if (!teamwork && skillsStatus() !== "ok" && valid) get("practice-score-total").textContent = "0";
    get("save-practice").disabled = !valid || endAt !== null || globalThis.TimerAudio.isStarting() || saving || !teamsReady;
    get("save-practice").textContent = selected ? "Update practice run" : "Save practice run";
    const studentRun = selected ? record()?.runRole === "member" : isMember();
    get("practice-ranking-note").textContent = ACTIVE_GAME.practiceOnly ? "Practice records are saved for this team and do not create event standings." : studentRun
      ? "Student run - saved for practice history and analysis, not leaderboards."
      : "";
    get("remove-practice").hidden = !selected;
    get("remove-practice").disabled = saving;
    get("cancel-practice-edit").hidden = !selected;
    get("cancel-practice-edit").disabled = saving;
    get("new-practice").disabled = get("new-practice-bottom").disabled = saving;
    const seconds = Math.ceil(Math.min(duration, remainingTime) / 1000);
    get("practice-timer").textContent = practiceClockText(remainingTime);
    get("practice-timer-dial").style.setProperty("--timer-progress-angle", practiceProgressAngle(remainingTime));
    const preparing = globalThis.TimerAudio.isStarting() || (endAt !== null && remainingTime > duration);
    const controlState = teamworkPhase === "handoff" ? "handoff" : ended ? "ended" : preparing ? "preparing" : endAt !== null ? "running" : started ? "paused" : "ready";
    const phaseLabel = teamworkPhase === "autonomous" ? "AUTONOMOUS PERIOD" : teamworkPhase === "handoff" ? "DRIVER PERIOD READY" : teamworkPhase === "driver" ? "DRIVER CONTROLLED PERIOD" : "";
    get("practice-timer-label").textContent = ended ? "PRACTICE RUN ENDED" : preparing ? "PREPARING TIMER" : teamworkPhase === "handoff" ? phaseLabel : started && endAt === null ? "PRACTICE RUN PAUSED" : endAt !== null ? phaseLabel || (mode() !== "autonomous" && inSwitchWindow(seconds * 1000) ? "DRIVER SWITCH WINDOW" : "PRACTICE IN PROGRESS") : "READY FOR PRACTICE";
    if (remainingTime > duration && get("timer-countdown").checked) get("practice-timer-label").textContent = `STARTING IN ${globalThis.TimerAudio.countdownNumber(remainingTime - duration)}`;
    get("practice-timer-stage").classList.toggle("ended", ended);
    const controls = get("practice-run-controls");
    controls.dataset.state = controlState;
    const reset = get("reset-practice-timer");
    reset.hidden = !["paused", "ended", "handoff"].includes(controlState);
    reset.setAttribute("aria-label", controlState === "handoff" ? "Cancel Teamwork run" : controlState === "paused" ? "Reset paused run" : "Reset timer");
    reset.title = controlState === "handoff" ? "Cancel Teamwork run" : controlState === "paused" ? "Reset paused run" : "Reset timer";
    reset.querySelector(".run-cancel-icon").toggleAttribute("hidden", !["paused", "handoff"].includes(controlState));
    reset.querySelector(".run-reset-icon").toggleAttribute("hidden", controlState !== "ended");
    get("start-practice").hidden = !["ready", "paused", "handoff"].includes(controlState);
    get("start-practice").classList.toggle("run-control-right", controlState === "handoff");
    get("start-practice").setAttribute("aria-label", controlState === "handoff" ? "Start Driver Controlled Period" : controlState === "paused" ? "Resume run" : "Start run");
    get("start-practice").title = controlState === "handoff" ? "Start Driver Controlled Period" : controlState === "paused" ? "Resume run" : "Start run";
    get("start-practice").disabled = !["ready", "paused", "handoff"].includes(controlState) || Boolean(selected) || (!teamsReady && !ACTIVE_GAME.practiceOnly) || saving || globalThis.TimerAudio.isStarting();
    get("pause-practice").hidden = controlState !== "running";
    get("stop-practice").hidden = !["running", "preparing"].includes(controlState);
    get("stop-practice").disabled = globalThis.TimerAudio.isStarting();
    get("reset-practice-timer").disabled = !canResetClock();
    const teams = scrimmage ? `Red ${selectedTeams[0]} + ${selectedTeams[1]} / Blue ${selectedTeams[2]} + ${selectedTeams[3]}` : teamwork ? `${selectedTeams[0]} + ${selectedTeams[1]}` : selectedTeams[0];
    get("practice-flow-label").textContent = `${selected ? "Editing practice run" : "Practice run"} \u00b7 ${modeName(mode())}${teams ? ` \u00b7 ${teams}` : ""}`;
    syncChanged();
    get("practice-flow-next").textContent = changed ? "Post & next run \u2192" : "Next run \u2192";
    get("practice-flow-next").disabled = saving || (changed && get("save-practice").disabled);
    get("new-practice-bottom").textContent = flowOpen() ? "Discard & next run" : "Next run";
    get("new-practice-bottom").hidden = flowOpen() && !changed;
    get("practice-fullscreen").disabled = !teamsReady && !ACTIVE_GAME.practiceOnly;
  }

  async function enterFlow() {
    if (flowOpen() || (!ACTIVE_GAME.practiceOnly && !validParticipants())) return;
    form.classList.add("flow-mode");
    document.body.classList.add("flow-open");
    get("notice").hidden = true;
    form.scrollTop = 0;
    update();
    try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen(); }
    catch { /* The overlay still fills the window when the browser blocks fullscreen. */ }
    clearInterval(flowWatch);
    // Fallback for browsers that leave fullscreen without firing fullscreenchange.
    if (document.fullscreenElement) flowWatch = setInterval(() => { if (!document.fullscreenElement) exitFlow(); }, 500);
  }

  function exitFlow() {
    if (!flowOpen()) return;
    form.classList.remove("flow-mode");
    document.body.classList.remove("flow-open");
    clearInterval(flowWatch);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    update();
  }

  function canResetClock() {
    return endAt === null && (teamworkPhase === "handoff" || ended || remainingTime !== practiceDuration()) && !globalThis.TimerAudio.isStarting();
  }

  function reset() {
    selected = null; changed = false; endAt = null; teamworkPhase = hasScrimmage && mode() === "teamwork" ? "autonomous" : null; remainingTime = practiceDuration(); started = false; ended = false;
    scoring = { goals: ACTIVE_GAME.emptyGoals() };
    gameData = hasGameField ? practiceField.empty() : null;
    runAt = null;
    get("practice-notes").value = "";
    get("practice-opt-in").checked = false;
    get("practice-stop").value = 0;
    teamOptions();
    renderPracticeScoring();
    captureBaseline();
    update();
  }

  function renderPractice() {
    teamOptions();
    if (!selected && !changed && !started) captureBaseline();
    renderRuns();
    update();
  }

  function renderRuns() {
    const team = get("practice-team").value;
    const teamOnly = get("practice-filter").value === "team" && team;
    get("practice-filter").options[0].textContent = team ? `Team ${team}` : "Selected team";
    const coach = accessRole() === "coach";
    get("practice-actions-heading").hidden = !coach;
    const canPromote = coach && !ACTIVE_GAME.practiceOnly;
    const shown = teamOnly ? records().filter(item => item.teams.some(entry => entry.id === team)) : records();
    get("practice-runs").innerHTML = shown.slice(-100).reverse().map(item => {
      const scrimmage = item.kind === "scrimmage";
      const teamwork = item.kind === "teamwork" || scrimmage;
      const value = item.kind === "teamwork" ? item.value.result : item.value;
      const teams = scrimmage ? `Red ${item.value.alliances.red.join(" + ")} / Blue ${item.value.alliances.blue.join(" + ")}` : item.teams.map(team => escapeText(team.id)).join(" + ");
      const score = scrimmage ? `Red ${item.value.scores.red} / Blue ${item.value.scores.blue}` : Core.score(value.counts);
      return `<tr><td>${escapeText(History.localDateTime(item.occurredAt))}</td><td>${modeName(teamwork ? "teamwork" : item.value.mode)}<small>${item.runRole === "member" ? "Student run (not ranked)" : "Coach run"}</small></td><td>${teams}</td><td>${score}</td><td>${escapeText(item.notes)}</td>${coach ? `<td><button type="button" data-edit-practice="${escapeText(item.runId)}">Edit</button>${canPromote && item.runRole === "member" ? `<button type="button" data-promote-practice="${escapeText(item.runId)}" title="Include this run in coach leaderboards">Promote</button>` : ""}</td>` : ""}</tr>`;
    }).join("") || `<tr><td colspan="${coach ? 6 : 5}">${teamOnly ? `No practice runs saved for team ${escapeText(team)}.` : "No practice runs saved."}</td></tr>`;
  }

  async function canLeave() {
    if (!idle()) return false;
    return !changed || (await ask("Discard the unposted practice changes?", "Discard changes", true));
  }

  async function promotePracticeRun(runId) {
    if (saving || accessRole() !== "coach" || !(await canLeave())) return;
    if (!(await ask("Promote this student run to coach leaderboards? The original student entry will remain in score history.", "Promote run"))) return;
    if (changed || selected) reset();
    try {
      const entry = History.promotePractice(state.history, runId);
      state = { ...state, history: [...state.history, entry] };
      saving = true;
      get("practice-form").inert = true;
      const pending = persist();
      render();
      if (await pending) notify("Practice run promoted to the coach leaderboards.");
    } catch (error) { notify(`Practice promotion failed: ${error.message}`); }
    finally { saving = false; get("practice-form").inert = false; update(); }
  }

  for (const id of ["new-practice", "new-practice-bottom"]) get(id).addEventListener("click", async () => { if (await canLeave()) reset(); });
  get("cancel-practice-edit").addEventListener("click", async () => {
    if (saving || (changed && !(await ask("Discard your changes to this practice run?", "Discard changes", true)))) return;
    reset();
    renderRuns();
  });
  get("practice-team").addEventListener("change", () => { practiceTeamTouched = true; renderRuns(); update(); });
  for (const id of ["practice-partner", "practice-blue-team", "practice-blue-partner"]) get(id).addEventListener("change", () => { renderRuns(); update(); });
  get("practice-mode").addEventListener("change", () => {
    if (hasGameField) gameData = practiceField.normalizeForMode(mode(), gameData);
    teamworkPhase = hasScrimmage && mode() === "teamwork" ? "autonomous" : null;
    endAt = null; remainingTime = practiceDuration(); started = false; ended = false; runAt = null;
    get("practice-stop").value = 0;
    teamOptions(); renderPracticeScoring(); update();
  });
  form.addEventListener("input", event => { if (event.target !== get("practice-mode")) update(); });
  form.addEventListener("change", event => { if (event.target !== get("practice-mode")) update(); });
  get("practice-filter").addEventListener("change", renderRuns);
  get("practice-runs").addEventListener("click", async event => {
    const promote = event.target.closest("[data-promote-practice]");
    if (promote) { await promotePracticeRun(promote.dataset.promotePractice); return; }
    const button = event.target.closest("[data-edit-practice]");
    if (!button || saving || accessRole() !== "coach" || !(await canLeave())) return;
    selected = button.dataset.editPractice;
    const saved = record();
    if (!saved) { notify("This practice run no longer exists. Reload shared data."); reset(); return; }
    const scrimmage = saved.kind === "scrimmage";
    const teamwork = scrimmage || saved.kind === "teamwork";
    const value = scrimmage ? saved.value : teamwork ? saved.value.result : saved.value;
    teamOptions();
    get("practice-mode").value = teamwork ? "teamwork" : value.mode;
    get("practice-team").value = scrimmage ? value.alliances.red[0] : teamwork ? saved.value.teams[0] : value.team;
    if (scrimmage) {
      get("practice-partner").value = value.alliances.red[1];
      get("practice-blue-team").value = value.alliances.blue[0];
      get("practice-blue-partner").value = value.alliances.blue[1];
    } else if (teamwork) {
      get("practice-partner").value = saved.value.teams[1];
    } else {
      get("practice-opt-in").checked = value.optIn;
      get("practice-stop").value = value.stopTime;
    }
    get("practice-notes").value = saved.notes;
    scoring = { goals: structuredClone(value.goals || Core.goalsFromCounts(value.counts)) };
    gameData = hasGameField ? structuredClone(value.gameData || practiceField.empty()) : null;
    changed = false; endAt = null; remainingTime = practiceDuration(); started = false; ended = false;
    renderPracticeScoring();
    captureBaseline();
    renderRuns();
    update();
    get("practice-mode").focus();
  });
  get("practice-form").addEventListener("input", update);
  calculator.addEventListener("click", event => {
    if (practiceView?.handleClick(event)) {
      update();
      return;
    }
    const button = event.target.closest("[data-step]");
    if (!button || button.disabled) return;
    const input = get(button.dataset.counter);
    input.value = Number(input.value) + Number(button.dataset.step);
    update();
  });
  async function save(message = "Practice run saved. Choose Next run to record another attempt.") {
    if (saving || !idle()) return false;
    let posted = false;
    try {
      const teamwork = mode() === "teamwork";
      const scrimmage = isScrimmage();
      const redTeams = [get("practice-team").value, get("practice-partner").value];
      const blueTeams = [get("practice-blue-team").value, get("practice-blue-partner").value];
      const team = redTeams[0];
      const partner = redTeams[1];
      const saved = record();
      const input = {
        runRole: accessRole() === "member" ? "member" : "coach",
        mode: mode(), teams: scrimmage ? [...redTeams, ...blueTeams] : teamwork ? redTeams : [team], goals: scoring.goals,
        ...(scrimmage ? { scrimmage: true, redTeams, blueTeams, gameData } : hasGameField ? { gameData } : {}),
        occurredAt: saved ? saved.occurredAt : runAt || new Date().toISOString(), notes: get("practice-notes").value,
        statuses: Object.fromEntries([team, partner].map(id => [id, saved?.kind === "teamwork" ? saved.value.result.statuses[id] || "ok" : "ok"])),
        status: skillsStatus(), optIn: get("practice-opt-in").checked,
        stopTime: Number(get("practice-stop").value)
      };
      const entry = History.practiceRecord(state.history, teamOptions(), input, selected);
      if (selected && !(await ask("Replace this practice run's score? The earlier version stays in history.", "Replace score"))) return false;
      state = { ...state, history: [...state.history, entry] };
      selected = entry.runId; captureBaseline(); saving = true;
      get("practice-form").inert = true;
      const pending = persist();
      render();
      posted = await pending;
      if (posted) notify(message);
    } catch (error) { notify(`Practice save failed: ${error.message}`); }
    finally { saving = false; get("practice-form").inert = false; update(); }
    return posted;
  }
  form.addEventListener("submit", event => { event.preventDefault(); save(); });
  get("practice-flow-next").addEventListener("click", async () => {
    if (changed ? !(await save("Practice run saved. Ready for the next run.")) : !idle()) return;
    reset();
    renderRuns();
    form.scrollTop = 0;
  });
  get("practice-fullscreen").addEventListener("click", enterFlow);
  get("practice-flow-exit").addEventListener("click", exitFlow);
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) exitFlow(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && flowOpen() && !document.fullscreenElement && !document.querySelector("dialog[open]")) exitFlow(); });
  get("remove-practice").addEventListener("click", async () => {
    if (!selected || saving || !idle() || !(await ask(`Remove this practice run? It will be excluded from analysis but retained in audit history.${changed ? " Your unsaved edits to this run will also be discarded." : ""}`, "Remove run", true))) return;
    try {
      const entry = History.removePractice(state.history, selected);
      state = { ...state, history: [...state.history, entry] };
      saving = true;
      get("practice-form").inert = true;
      const pending = persist();
      reset(); render();
      if (await pending) notify("Practice run removed. Its audit history has been kept.");
    } catch (error) { notify(`Practice removal failed: ${error.message}`); }
    finally { saving = false; get("practice-form").inert = false; update(); }
  });
  function advanceToDriverHandoff() {
    if (!hasScrimmage || mode() !== "teamwork" || teamworkPhase !== "autonomous") return false;
    globalThis.TimerAudio.finish();
    endAt = null;
    teamworkPhase = "handoff";
    remainingTime = practiceTiming.driverPeriodMs;
    started = true;
    ended = false;
    get("practice-stop").value = 0;
    update();
    return true;
  }
  get("start-practice").addEventListener("click", async () => {
    if (globalThis.TimerAudio.isStarting()) { notify("Wait for the timer audio to become ready."); return; }
    if (endAt !== null || !idle() || ended || selected || get("start-practice").disabled) return;
    if (hasScrimmage && mode() === "teamwork" && teamworkPhase === "handoff") {
      teamworkPhase = "driver";
      remainingTime = practiceDuration();
      started = true;
      const ready = globalThis.TimerAudio.start(remainingTime, false, false);
      update();
      endAt = await ready;
      if (endAt !== null) remainingTime = Math.max(0, endAt - globalThis.TimerAudio.now());
      update();
      return;
    }
    const fresh = !started;
    started = true;
    if (fresh) runAt = new Date().toISOString();
    if (hasScrimmage && mode() === "teamwork") teamworkPhase = "autonomous";
    const ready = globalThis.TimerAudio.start(remainingTime, fresh, Boolean(Core.TIMING.driverSwitch && mode() !== "autonomous"));
    update();
    endAt = await ready;
    if (endAt !== null) remainingTime = Math.max(0, endAt - globalThis.TimerAudio.now());
    update();
  });
  get("pause-practice").addEventListener("click", () => {
    if (endAt === null || globalThis.TimerAudio.isStarting() || remainingTime > practiceDuration()) return;
    remainingTime = Math.max(0, endAt - globalThis.TimerAudio.now());
    endAt = null;
    if (remainingTime === 0) {
      if (advanceToDriverHandoff()) return;
      ended = true;
      get("practice-stop").value = 0;
      globalThis.TimerAudio.finish();
    } else globalThis.TimerAudio.stop();
    update();
  });
  get("stop-practice").addEventListener("click", () => {
    if (globalThis.TimerAudio.isStarting()) {
      globalThis.TimerAudio.stop();
      endAt = null; remainingTime = practiceDuration(); started = false; ended = false; runAt = null;
      get("practice-stop").value = 0;
      update(); return;
    }
    if (endAt === null) return;
    const remaining = Math.max(0, endAt - globalThis.TimerAudio.now());
    if (remaining > practiceDuration()) {
      globalThis.TimerAudio.stop();
      endAt = null; remainingTime = practiceDuration(); started = false; ended = false; runAt = null;
      get("practice-stop").value = 0;
      update(); return;
    }
    remainingTime = remaining;
    endAt = null; ended = true;
    if (mode() !== "teamwork" && get("practice-opt-in").checked) get("practice-stop").value = Math.ceil(remainingTime / 1000);
    globalThis.TimerAudio.finish();
    update();
  });
  get("reset-practice-timer").addEventListener("click", () => {
    if (!canResetClock()) return;
    if (teamworkPhase === "handoff") { reset(); renderRuns(); return; }
    teamworkPhase = hasScrimmage && mode() === "teamwork" ? "autonomous" : null;
    endAt = null; remainingTime = practiceDuration(); started = false; ended = false; runAt = null;
    get("practice-stop").value = 0;
    update();
  });
  setInterval(() => {
    if (endAt === null) return;
    remainingTime = Math.max(0, endAt - globalThis.TimerAudio.now());
    if (remainingTime === 0 && !advanceToDriverHandoff()) { endAt = null; ended = true; get("practice-stop").value = 0; }
    update();
  }, 25);
  globalThis.PracticeUI = { render: renderPractice, reset, exitFlow, isDirty: () => changed, isRunning: () => endAt !== null };
  reset();
})();
