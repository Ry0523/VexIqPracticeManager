(function () {
  "use strict";
  function createUI(Rubric, key, prefix, label) {
  const get = id => document.getElementById(id.replace("rubric", prefix));
  const count = Rubric.criteria.length;
  const maximum = count * Rubric.maximum;
  // Evaluations are kept per game; only the active game's are shown and edited.
  const entries = () => Game.forGame(state[key]);
  let selected = null;
  // ID of the saved review loaded into the form, or null when the form is a new review.
  let editing = null;
  let changed = false;
  let saving = false;
  // Reviews whose notes panel is open (team-member view).
  const openNotes = new Set();
  const form = get("rubric-form");
  // Members see their team's feedback plus reviews they authored for other teams.
  const memberTeam = () => globalThis.EventStorage?.access?.role === "member" ? globalThis.EventStorage.access.team : null;
  const authorEmail = () => globalThis.EventStorage?.access?.email || "";
  const canManage = entry => accessRole() === "coach" || (memberTeam() !== null && entry.reviewRole === "member" && entry.authorEmail === authorEmail() && Boolean(authorEmail()));
  const canRead = entry => memberTeam() === null || entry.team.id === memberTeam() || canManage(entry);
  const directory = () => {
    const teams = new Map(entries().map(entry => [entry.team.id, entry.team]));
    for (const team of state.teams) teams.set(team.id, team);
    return teams;
  };
  const editingEntry = () => editing === null ? null : entries().find(entry => entry.id === editing) || null;
  const title = label === "notebook" ? "Notebook" : "Interview";
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  const sections = [...new Set(Rubric.criteria.map(item => item.section))];
  const ratings = Array.from({ length: Rubric.maximum - Rubric.minimum + 1 }, (_, index) => index + Rubric.minimum);
  const levels = label === "notebook" ? ["Beginning", "Developing", "Proficient", "Exemplary"] : ["Not Yet Heard", "Heard", "Heard, with Specifics"];
  get("rubric-criteria").innerHTML = sections.map((section, index) => `<fieldset class="rubric-group"><legend>${section} <span id="${prefix}-section-${index}"></span></legend>${Rubric.criteria.filter(item => item.section === section).map(item => `<div class="rubric-criterion"><div><label for="${prefix}-score-${item.id}">${item.title}</label><p class="rules-note" id="${prefix}-help-${item.id}">${item.prompt}</p></div><label>Points<select id="${prefix}-score-${item.id}" aria-label="Points for ${item.title}" aria-describedby="${prefix}-help-${item.id}"><option value="">Not scored</option>${ratings.map(score => `<option value="${score}">${score}</option>`).join("")}</select></label><label class="rubric-feedback">Evidence / coaching notes<textarea id="${prefix}-note-${item.id}" aria-label="Evidence and coaching notes for ${item.title}" maxlength="2000" rows="2"></textarea></label><p class="rubric-previous" id="${prefix}-previous-${item.id}" hidden></p></div>`).join("")}</fieldset>`).join("");
  for (const item of Rubric.criteria) {
    const help = get(`rubric-help-${item.id}`);
    const guidance = globalThis.RubricGuidance[label][item.id];
    help.insertAdjacentHTML("afterend", `<details class="rubric-guidance"><summary>Scoring guidance for ${escapeText(item.title)}</summary><p class="rules-note">Coaching summary, not official descriptors. Use the linked rubric for authoritative guidance.</p><dl>${ratings.map((score, index) => `<dt>${score} - ${escapeText(levels[index])}</dt><dd>${escapeText(guidance[index])}</dd>`).join("")}</dl><p class="rules-note">Not scored: this criterion has not been assessed yet.</p></details>`);
  }

  function read() {
    return {
      evaluatedOn: get("rubric-date").value, reviewer: get("rubric-reviewer").value,
      overallNotes: get("rubric-overall").value,
      reviewRole: memberTeam() === null ? "coach" : "member", authorEmail: authorEmail(),
      scores: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, get(`rubric-score-${id}`).value === "" ? null : Number(get(`rubric-score-${id}`).value)])),
      notes: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, get(`rubric-note-${id}`).value]))
    };
  }

  function update() {
    const values = Rubric.criteria.map(({ id }) => get(`rubric-score-${id}`).value).filter(value => value !== "");
    get("rubric-total").textContent = `${values.reduce((sum, score) => sum + Number(score), 0)} / ${maximum}`;
    get("rubric-completion").textContent = `${values.length} / ${count} criteria scored in this review`;
    sections.forEach((section, index) => {
      const items = Rubric.criteria.filter(item => item.section === section);
      get(`rubric-section-${index}`).textContent = `(${items.reduce((sum, { id }) => sum + Number(get(`rubric-score-${id}`).value), 0)} / ${items.length * Rubric.maximum})`;
    });
    const entry = editingEntry();
    get("save-rubric").disabled = saving || !selected;
    get("save-rubric").textContent = entry ? "Save changes" : "Save new review";
    get("cancel-rubric").hidden = !entry;
    get("cancel-rubric").disabled = saving;
    get("rubric-form-title").textContent = entry ? `Editing ${entry.reviewRole === "member" ? "student " : ""}review from ${entry.evaluatedOn}` : memberTeam() !== null ? "New student review - does not count toward the leaderboard" : "New review";
    get("rubric-saved").textContent = changed ? "Unsaved changes" : entry ? `Review last saved: ${History.localDateTime(entry.updatedAt)}` : "New review - not saved yet";
  }

  // Shows each criterion's earlier result (excluding the review being edited) as a reference for this review.
  function previous() {
    const result = selected ? Rubric.current(entries(), selected, editing) : null;
    for (const { id } of Rubric.criteria) {
      const element = get(`rubric-previous-${id}`);
      const item = result && result.criteria[id];
      const parts = [];
      if (item && item.score !== null) parts.push(`Earlier score: ${item.score} (${item.scoredOn})`);
      if (item && item.note.trim()) parts.push(`Earlier note (${item.notedOn}): ${item.note}`);
      element.textContent = parts.join("\n");
      element.hidden = !parts.length;
    }
  }

  function load() {
    if (editing !== null && !editingEntry()) editing = null;
    const entry = editingEntry();
    get("rubric-date").value = entry?.evaluatedOn || today();
    get("rubric-reviewer").value = entry?.reviewer || "";
    get("rubric-overall").value = entry?.overallNotes || "";
    for (const { id } of Rubric.criteria) {
      get(`rubric-score-${id}`).value = entry?.scores[id] ?? "";
      get(`rubric-note-${id}`).value = entry?.notes[id] || "";
    }
    changed = false;
    previous();
    update();
  }

  // Read-only notes let members read feedback without loading someone else's review into their form.
  function details(entry) {
    const scored = value => value !== null && value !== undefined;
    const overall = (entry.overallNotes || "").trim();
    const groups = sections.map(section => {
      const items = Rubric.criteria.filter(item => item.section === section);
      const points = items.reduce((sum, { id }) => sum + (scored(entry.scores[id]) ? entry.scores[id] : 0), 0);
      const rows = items.map(item => {
        const score = entry.scores[item.id];
        const note = (entry.notes[item.id] || "").trim();
        const badge = scored(score) ? `<span class="review-score" aria-label="${score} of ${Rubric.maximum} points">${score}<small>/${Rubric.maximum}</small></span>` : `<span class="review-score unscored">Not scored</span>`;
        return `<li class="${note ? "" : "no-note"}"><div class="review-criterion">${escapeText(item.title)}${badge}</div>${note ? `<p>${escapeText(note)}</p>` : ""}</li>`;
      }).join("");
      return `<section><h4>${escapeText(section)}<span>${points} / ${items.length * Rubric.maximum}</span></h4><ul>${rows}</ul></section>`;
    }).join("");
    return `<div class="review-notes" id="${prefix}-notes-${escapeText(entry.id)}">${overall ? `<div class="review-overall"><h4>Overall notes</h4><p>${escapeText(overall)}</p></div>` : ""}<div class="review-sections">${groups}</div></div>`;
  }

  function renderHistory() {
    const history = selected ? Rubric.reviews(entries(), selected).filter(canRead) : [];
    const result = selected ? Rubric.current(entries(), selected) : null;
    get("rubric-team-history").hidden = !selected;
    get("rubric-team-history").querySelector("th:last-child").textContent = "Actions";
    get("rubric-current").textContent = result
      ? `Current coach ${label} score: ${result.total} / ${result.maximum}, ${result.scored} / ${count} criteria scored${result.scored < count ? " (incomplete)" : ""} - latest coach score for each criterion across ${result.reviews} review${result.reviews === 1 ? "" : "s"}. Student reviews do not count toward the leaderboard.`
      : `No coach ${label} reviews saved for this team yet. Student reviews do not count toward the leaderboard.`;
    get("rubric-history-rows").innerHTML = [...history].reverse().map(entry => {
      const points = Rubric.summary(entry);
      const when = escapeText(entry.evaluatedOn);
      const disabled = saving ? " disabled" : "";
      const open = openNotes.has(entry.id);
      const toggle = `<button type="button" class="notes-toggle" data-review-notes="${escapeText(entry.id)}" aria-expanded="${open}" aria-controls="${prefix}-notes-${escapeText(entry.id)}" aria-label="${open ? "Hide" : "View"} notes for the ${label} review from ${when}">${open ? "Hide notes" : "View notes"}</button>`;
      const panel = memberTeam() !== null && open ? `<tr class="review-notes-row"><td colspan="5">${details(entry)}</td></tr>` : "";
      const actions = canManage(entry) ? `<div class="review-actions"><button type="button" data-review-edit="${escapeText(entry.id)}" aria-label="Edit ${label} review from ${when}"${disabled}>Edit</button><button type="button" data-review-delete="${escapeText(entry.id)}" aria-label="Delete ${label} review from ${when}"${disabled}>Delete</button></div>` : "";
      return `<tr class="${open ? "notes-open" : ""}"><td>${when}${entry.id === editing ? " (editing)" : ""}</td><td>${escapeText(entry.reviewer)}<small>${entry.reviewRole === "member" ? "Student review (not ranked)" : "Coach review"}</small></td><td>${points.total}</td><td>${points.scored} / ${count}</td><td>${memberTeam() !== null ? toggle : ""}${actions}</td></tr>${panel}`;
    }).join("") || `<tr><td colspan="5">No reviews yet. Save the form below to start this team's history.</td></tr>`;
  }

  function renderRubric() {
    const teams = directory();
    if (!teams.has(selected)) {
      selected = teams.has(memberTeam()) ? memberTeam() : teams.keys().next().value || null;
      editing = null;
      load();
    } else if (editing !== null && !editingEntry()) {
      editing = null;
      load();
    }
    get("rubric-team").innerHTML = [...teams.values()].map(team => `<option value="${escapeText(team.id)}">${escapeText(team.id)} / ${escapeText(team.name)}</option>`).join("");
    get("rubric-team").value = selected || "";
    get("rubric-team").disabled = saving || !teams.size;
    form.hidden = !selected || accessRole() === "viewer";
    get("rubric-empty").hidden = Boolean(selected);
    get("rubric-empty").textContent = memberTeam() === null ? `Add teams in Teams & schedule to start ${label === "notebook" ? "an evaluation" : "an interview evaluation"}.` : `No ${label} reviews are available yet.`;
    renderHistory();
    const reviewed = [...teams.keys()].filter(id => entries().some(entry => entry.team.id === id && canRead(entry)));
    get("rubric-rows").innerHTML = reviewed.map(id => {
      const result = Rubric.current(entries(), id);
      if (!result) return `<tr><td><button type="button" data-rubric-team="${escapeText(id)}">${escapeText(id)}</button></td><td>${escapeText(teams.get(id).name)}</td><td colspan="4">Student reviews only - no coach score yet</td></tr>`;
      return `<tr><td><button type="button" data-rubric-team="${escapeText(id)}">${escapeText(id)}</button></td><td>${escapeText(teams.get(id).name)}</td><td>${escapeText(result.latest.evaluatedOn)}</td><td>${result.reviews}</td><td>${result.total} / ${result.maximum}</td><td>${result.scored} / ${count}${result.scored < count ? " (incomplete)" : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="6">No ${label} reviews saved.</td></tr>`;
    get("export-rubrics").disabled = !entries().length;
    update();
  }

  const discard = async () => !changed || (await ask(`Discard the unsaved ${label} review changes?`, "Discard changes", true));

  async function select(team) {
    if (saving || !(await discard())) {
      get("rubric-team").value = selected || "";
      return;
    }
    selected = team;
    editing = null;
    load();
    renderRubric();
  }

  async function edit(id) {
    if (saving || id === editing || !(await discard())) return;
    if (!entries().some(entry => entry.id === id && canManage(entry))) { notify("You can only edit your own student reviews."); return; }
    editing = id;
    load();
    renderRubric();
    get("rubric-form-title").scrollIntoView({ block: "start" });
    get("rubric-date").focus({ preventScroll: true });
  }

  async function store(evaluations, message) {
    state = { ...state, [key]: evaluations };
    saving = true;
    get("rubric-view").inert = true;
    try {
      const pending = persist();
      render();
      if (await pending) notify(message);
    } finally { saving = false; get("rubric-view").inert = false; renderRubric(); }
  }

  async function removeReview(id) {
    if (saving) return;
    const entry = entries().find(item => item.id === id);
    if (entry && !canManage(entry)) { notify("You can only delete your own student reviews."); return; }
    if (!entry || !(await ask(`Delete the ${label} review for ${entry.team.id} from ${entry.evaluatedOn}? This cannot be undone.`, "Delete review", true))) return;
    try {
      const evaluations = Rubric.remove(state[key], id);
      if (editing === id) { editing = null; changed = false; }
      await store(evaluations, `${title} review from ${entry.evaluatedOn} deleted.`);
      if (editing === null && !changed) load();
    } catch (error) { notify(`${label} review delete failed: ${error.message}`); }
  }

  get("rubric-team").addEventListener("change", event => select(event.target.value));
  get("rubric-rows").addEventListener("click", event => {
    const button = event.target.closest("[data-rubric-team]");
    if (button) { select(button.dataset.rubricTeam); get("rubric-team").focus(); }
  });
  get("rubric-history-rows").addEventListener("click", event => {
    const notes = event.target.closest("[data-review-notes]");
    if (notes) {
      const id = notes.dataset.reviewNotes;
      if (!openNotes.delete(id)) openNotes.add(id);
      renderHistory();
      get("rubric-history-rows").querySelector(`[data-review-notes="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    const editButton = event.target.closest("[data-review-edit]");
    const deleteButton = event.target.closest("[data-review-delete]");
    if (editButton) edit(editButton.dataset.reviewEdit);
    if (deleteButton) removeReview(deleteButton.dataset.reviewDelete);
  });
  get("cancel-rubric").addEventListener("click", async () => {
    if (saving || !(await discard())) return;
    editing = null;
    load();
    renderRubric();
  });
  form.addEventListener("input", () => { changed = true; update(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || !selected || accessRole() === "viewer") return;
    if (editingEntry() && !canManage(editingEntry())) { notify("You can only edit your own student reviews."); return; }
    try {
      const updated = editingEntry();
      const evaluations = Rubric.save(state[key], directory().get(selected), read(), editing);
      editing = null;
      changed = false;
      await store(evaluations, updated ? `${title} review from ${updated.evaluatedOn} updated.` : `${title} review saved. Earlier reviews are kept in this team's history.`);
      load();
    } catch (error) { notify(`${label} review save failed: ${error.message}`); }
  });
  get("export-rubrics").addEventListener("click", async () => {
    if (changed && !(await ask(`Unsaved ${label} edits are not included. Export saved reviews anyway?`, "Export anyway"))) return;
    try { download(Rubric.csv(entries()), fileName(`${label}-rubrics.csv`), "text/csv;charset=utf-8"); }
    catch (error) { notify(`${label} export failed: ${error.message}`); }
  });
  const controller = { render: renderRubric, reset: () => { selected = null; editing = null; changed = false; renderRubric(); load(); }, isDirty: () => changed };
  renderRubric();
  return controller;
  }
  globalThis.RubricUI = createUI(globalThis.NotebookRubric, "rubrics", "rubric", "notebook");
  globalThis.InterviewUI = createUI(globalThis.InterviewRubric, "interviews", "interview", "interview");
})();
