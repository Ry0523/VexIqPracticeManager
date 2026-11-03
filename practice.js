(function () {
  "use strict";
  const calculator = get("practice-scoring-inputs");
  const form = get("practice-form");
  const flowOpen = () => form.classList.contains("flow-mode");
  let flowWatch = null;
  let scoring = { goals: ACTIVE_GAME.emptyGoals() };
  let selected = null;
  let changed = false;
  let endAt = null;
  let remainingTime = MATCH_MS;
  let started = false;
  let ended = false;
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

  function teamOptions() {
    const directory = new Map((record()?.teams || []).map(team => [team.id, team]));
    for (const team of state.teams) directory.set(team.id, team);
    for (const id of ["practice-team", "practice-partner"]) {
      const input = get(id);
      const previous = input.value;
      input.innerHTML = [...directory.values()].map(team => `<option value="${escapeText(team.id)}">${escapeText(team.id)} / ${escapeText(team.name)}</option>`).join("");
      if (directory.has(previous)) input.value = previous;
    }
    if (!selected && !changed && get("practice-partner").value === get("practice-team").value && directory.size > 1) get("practice-partner").selectedIndex = 1;
    return [...directory.values()];
  }

  function update() {
    const teamwork = mode() === "teamwork";
    get("practice-partner-field").hidden = !teamwork;
    for (const id of ["practice-opt-in-field", "practice-stop-field"]) get(id).hidden = teamwork;
    const stopAllowed = !teamwork && get("practice-opt-in").checked && skillsStatus() === "ok";
    if (!stopAllowed) get("practice-stop").value = 0;
    get("practice-stop").disabled = !stopAllowed || endAt !== null;
    get("practice-opt-in").disabled = started;
    for (const id of ["practice-mode", "practice-team", "practice-partner"]) get(id).disabled = endAt !== null || globalThis.TimerAudio.isStarting();
    const valid = updateCalculator(calculator, scoring, get("practice-score-total"), get("practice-bag-total"));
    get("practice-score-label").textContent = teamwork ? "Alliance field score" : "Skills score";
    if (!teamwork && skillsStatus() !== "ok" && valid) get("practice-score-total").textContent = "0";
    get("save-practice").disabled = !valid || endAt !== null || globalThis.TimerAudio.isStarting() || saving || !get("practice-team").value || (teamwork && (!get("practice-partner").value || get("practice-partner").value === get("practice-team").value));
    get("save-practice").textContent = selected ? "Update practice run" : "Save practice run";
    get("practice-ranking-note").textContent = (selected ? record()?.runRole === "member" : isMember())
      ? "Student run - saved for practice history and analysis, not leaderboards."
      : "Coach run - counts toward leaderboards.";
    get("remove-practice").hidden = !selected;
    get("remove-practice").disabled = saving;
    get("cancel-practice-edit").hidden = !selected;
    get("cancel-practice-edit").disabled = saving;
    get("new-practice").disabled = get("new-practice-bottom").disabled = saving;
    const seconds = Math.ceil(Math.min(MATCH_MS, remainingTime) / 1000);
    get("practice-timer").textContent = clockText(remainingTime);
    get("practice-timer-label").textContent = ended ? "PRACTICE RUN ENDED" : endAt !== null ? mode() !== "autonomous" && inSwitchWindow(seconds * 1000) ? "DRIVER SWITCH WINDOW" : "PRACTICE IN PROGRESS" : "READY FOR PRACTICE";
    if (remainingTime > MATCH_MS) get("practice-timer-label").textContent = `STARTING IN ${globalThis.TimerAudio.countdownNumber(remainingTime - MATCH_MS)}`;
    get("practice-timer-stage").classList.toggle("ended", ended);
    get("start-practice").textContent = endAt !== null ? "End run" : "Start run";
    if (globalThis.TimerAudio.isStarting()) get("practice-timer-label").textContent = "PREPARING TIMER";
    get("start-practice").disabled = ended || Boolean(selected) || !get("practice-team").value || saving || globalThis.TimerAudio.isStarting() || (teamwork && (!get("practice-partner").value || get("practice-partner").value === get("practice-team").value));
    get("reset-practice-timer").disabled = !canResetClock();
    const teams = teamwork ? `${get("practice-team").value} + ${get("practice-partner").value}` : get("practice-team").value;
    get("practice-flow-label").textContent = `${selected ? "Editing practice run" : "Practice run"} \u00b7 ${modeName(mode())}${teams ? ` \u00b7 ${teams}` : ""}`;
    get("practice-flow-next").textContent = changed ? "Post & next run \u2192" : "Next run \u2192";
    get("practice-flow-next").disabled = saving || (changed && get("save-practice").disabled);
    get("new-practice-bottom").textContent = flowOpen() ? "Discard & next run" : "Next run";
    get("new-practice-bottom").hidden = flowOpen() && !changed;
    get("practice-fullscreen").disabled = !get("practice-team").value;
  }

  async function enterFlow() {
    if (flowOpen() || !get("practice-team").value) return;
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
    return endAt === null && (ended || remainingTime !== MATCH_MS) && !globalThis.TimerAudio.isStarting();
  }

  function reset() {
    selected = null; changed = false; endAt = null; remainingTime = MATCH_MS; started = false; ended = false;
    scoring = { goals: ACTIVE_GAME.emptyGoals() };
    runAt = null;
    get("practice-notes").value = "";
    get("practice-opt-in").checked = false;
    get("practice-stop").value = 0;
    teamOptions();
    renderScoringInputs(calculator, scoring, "practice-goal");
    update();
  }

  function renderPractice() {
    teamOptions();
    renderRuns();
    update();
  }

  function renderRuns() {
    const team = get("practice-team").value;
    const teamOnly = get("practice-filter").value === "team" && team;
    get("practice-filter").options[0].textContent = team ? `Team ${team}` : "Selected team";
    const coach = accessRole() === "coach";
    get("practice-actions-heading").hidden = !coach;
    const shown = teamOnly ? records().filter(item => item.teams.some(entry => entry.id === team)) : records();
    get("practice-runs").innerHTML = shown.slice(-100).reverse().map(item => {
      const value = item.kind === "teamwork" ? item.value.result : item.value;
      return `<tr><td>${escapeText(History.localDateTime(item.occurredAt))}</td><td>${modeName(item.kind === "teamwork" ? "teamwork" : item.value.mode)}<small>${item.runRole === "member" ? "Student run (not ranked)" : "Coach run"}</small></td><td>${item.teams.map(team => escapeText(team.id)).join(" + ")}</td><td>${Core.score(value.counts)}</td><td>${escapeText(item.notes)}</td>${coach ? `<td><button type="button" data-edit-practice="${escapeText(item.runId)}">Edit</button></td>` : ""}</tr>`;
    }).join("") || `<tr><td colspan="${coach ? 6 : 5}">${teamOnly ? `No practice runs saved for team ${escapeText(team)}.` : "No practice runs saved."}</td></tr>`;
  }

  async function canLeave() {
    if (!idle()) return false;
    return !changed || (await ask("Discard the unposted practice changes?", "Discard changes", true));
  }

  for (const id of ["new-practice", "new-practice-bottom"]) get(id).addEventListener("click", async () => { if (await canLeave()) reset(); });
  get("cancel-practice-edit").addEventListener("click", async () => {
    if (saving || (changed && !(await ask("Discard your changes to this practice run?", "Discard changes", true)))) return;
    reset();
    renderRuns();
  });
  get("practice-team").addEventListener("change", renderRuns);
  get("practice-filter").addEventListener("change", renderRuns);
  get("practice-runs").addEventListener("click", async event => {
    const button = event.target.closest("[data-edit-practice]");
    if (!button || saving || accessRole() !== "coach" || !(await canLeave())) return;
    selected = button.dataset.editPractice;
    const saved = record();
    if (!saved) { notify("This practice run no longer exists. Reload shared data."); reset(); return; }
    const teamwork = saved.kind === "teamwork";
    const value = teamwork ? saved.value.result : saved.value;
    teamOptions();
    get("practice-mode").value = teamwork ? "teamwork" : value.mode;
    get("practice-team").value = teamwork ? saved.value.teams[0] : value.team;
    if (teamwork) {
      get("practice-partner").value = saved.value.teams[1];
    } else {
      get("practice-opt-in").checked = value.optIn;
      get("practice-stop").value = value.stopTime;
    }
    get("practice-notes").value = saved.notes;
    scoring = { goals: structuredClone(value.goals || Core.goalsFromCounts(value.counts)) };
    changed = false; endAt = null; remainingTime = MATCH_MS; started = false; ended = false;
    renderScoringInputs(calculator, scoring, "practice-goal");
    renderRuns();
    update();
    get("practice-mode").focus();
  });
  get("practice-form").addEventListener("input", () => { changed = true; update(); });
  calculator.addEventListener("click", event => {
    const button = event.target.closest("[data-step]");
    if (!button || button.disabled) return;
    const input = get(button.dataset.counter);
    input.value = Number(input.value) + Number(button.dataset.step);
    changed = true; update();
  });
  async function save(message = "Practice run saved. Choose Next run to record another attempt.") {
    if (saving || !idle()) return false;
    let posted = false;
    try {
      const teamwork = mode() === "teamwork";
      const team = get("practice-team").value;
      const partner = get("practice-partner").value;
      const saved = record();
      const input = {
        runRole: accessRole() === "member" ? "member" : "coach",
        mode: mode(), teams: teamwork ? [team, partner] : [team], goals: scoring.goals,
        occurredAt: saved ? saved.occurredAt : runAt || new Date().toISOString(), notes: get("practice-notes").value,
        statuses: Object.fromEntries([team, partner].map(id => [id, saved?.kind === "teamwork" ? saved.value.result.statuses[id] || "ok" : "ok"])),
        status: skillsStatus(), optIn: get("practice-opt-in").checked,
        stopTime: Number(get("practice-stop").value)
      };
      const entry = History.practiceRecord(state.history, teamOptions(), input, selected);
      if (selected && !(await ask("Replace this practice run's score? The earlier version stays in history.", "Replace score"))) return false;
      state = { ...state, history: [...state.history, entry] };
      selected = entry.runId; changed = false; saving = true;
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
  get("start-practice").addEventListener("click", async () => {
    if (globalThis.TimerAudio.isStarting()) { notify("Wait for the timer audio to become ready."); return; }
    if (endAt !== null) {
      if (endAt - globalThis.TimerAudio.now() > MATCH_MS) {
        globalThis.TimerAudio.stop();
        endAt = null; remainingTime = MATCH_MS; started = false; ended = false;
        update(); return;
      }
      remainingTime = Math.max(0, endAt - globalThis.TimerAudio.now());
      endAt = null; ended = true;
      if (mode() !== "teamwork" && get("practice-opt-in").checked) get("practice-stop").value = Math.ceil(remainingTime / 1000);
      changed = true; globalThis.TimerAudio.finish();
    } else {
      if (!idle() || ended || selected || get("start-practice").disabled) return;
      started = true; changed = true;
      runAt = new Date().toISOString();
      const ready = globalThis.TimerAudio.start(remainingTime, true, mode() !== "autonomous");
      update();
      endAt = await ready;
      if (endAt !== null) remainingTime = Math.max(0, endAt - globalThis.TimerAudio.now());
    }
    update();
  });
  get("reset-practice-timer").addEventListener("click", () => {
    if (!canResetClock()) return;
    endAt = null; remainingTime = MATCH_MS; started = false; ended = false;
    get("practice-stop").value = 0;
    changed = true; update();
  });
  setInterval(() => {
    if (endAt === null) return;
    remainingTime = Math.max(0, endAt - globalThis.TimerAudio.now());
    if (remainingTime === 0) { endAt = null; ended = true; get("practice-stop").value = 0; changed = true; }
    update();
  }, 25);
  globalThis.PracticeUI = { render: renderPractice, reset, exitFlow, isDirty: () => changed, isRunning: () => endAt !== null };
  reset();
})();
