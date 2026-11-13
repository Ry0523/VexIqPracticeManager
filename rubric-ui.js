/** Shared UI controller for notebook and interview reviews, selected by rubric capability. */
(function () {
  "use strict";
  const evidenceNotesKey = "rubric-evidence-notes";
  let showEvidenceNotes = true;
  try { showEvidenceNotes = localStorage.getItem(evidenceNotesKey) !== "off"; } catch {}
  function syncGuidanceVisibility() {
    document.querySelectorAll(".rubric-evidence-notes-toggle").forEach(label => {
      label.querySelector("[data-rubric-evidence-notes]").checked = showEvidenceNotes;
    });
    document.querySelectorAll(".rubric-feedback").forEach(notes => { notes.hidden = !showEvidenceNotes; });
  }
  document.querySelectorAll("[data-rubric-evidence-notes]").forEach(toggle => toggle.addEventListener("change", () => {
    showEvidenceNotes = toggle.checked;
    try { localStorage.setItem(evidenceNotesKey, showEvidenceNotes ? "on" : "off"); } catch {}
    syncGuidanceVisibility();
  }));
  function configureGuidanceSelector(name) {
    const guidanceVersion = document.getElementById(`${name}-guidance-version`);
    const guidanceLink = document.getElementById(`${name}-guidance-link`);
    if (!guidanceVersion || !guidanceLink) return;
    try {
      const saved = localStorage.getItem(`${name}-guidance-version`);
      if ([...guidanceVersion.options].some(option => option.value === saved)) guidanceVersion.value = saved;
    } catch {}
    const updateGuidanceLink = () => {
      const option = guidanceVersion.selectedOptions[0];
      guidanceLink.href = option.dataset.pdf;
      guidanceLink.textContent = `Open ${option.textContent} PDF`;
      try { localStorage.setItem(`${name}-guidance-version`, option.value); } catch {}
    };
    guidanceVersion.addEventListener("change", updateGuidanceLink);
    updateGuidanceLink();
  }
  configureGuidanceSelector("notebook");
  configureGuidanceSelector("interview");
  function createUI(Rubric, key, prefix, label) {
  const get = id => document.getElementById(id.replace("rubric", prefix));
  const guidanceVersion = document.getElementById(`${label}-guidance-version`);
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
  const sectionTitles = {
    notebook: {
      official: {
      "Notebook organization": "Notebook Organization",
      Define: "Engineering Design Process – Define",
      "Develop solutions": "Engineering Design Process – Develop Solutions",
      Optimize: "Engineering Design Process – Optimize",
      "Reflection and iteration": "Engineering Design Process – Reflection and Iteration"
      },
      student: {
      "Notebook organization": "Is our notebook easy to use?",
      Define: "Did we explain the problem? – Define",
      "Develop solutions": "Did we build, test, and decide? – Develop Solutions",
      Optimize: "Did we make it better? – Optimize",
      "Reflection and iteration": "Did we try and learn again? – Reflection and Iteration"
      }
    },
    interview: {
      official: {
        "Explain your learning": "Explain your learning",
        "Working with others": "Working with others"
      },
      student: {
        "Explain your learning": "How We Explain Our Work",
        "Working with others": "How We Work Together"
      }
    }
  };
  const sectionTitle = section => sectionTitles[label]?.[guidanceVersion?.value === "student" ? "student" : "official"]?.[section] || section;
  const studentCriterionTitles = {
    notebook: {
      navigation: "Finding things",
      contributors: "Who wrote it",
      season: "Writing all season",
      sources: "Where ideas came from",
      constraints: "The problem, criteria, and constraints",
      strategy: "Our scoring plan",
      brainstorm: "Our ideas",
      prototypes: "Trying more than one version",
      procedures: "How we tested",
      data: "What our tests showed",
      decisions: "Explaining our choices",
      mechanisms: "Showing how it is built",
      code: "Showing our code",
      changes: "Why we changed things",
      reflection: "Thinking about how it is going",
      iteration: "Going through the process again"
    },
    interview: {
      "own-work": "Explaining our own work",
      development: "Telling the story of how we got here",
      evidence: "Showing how we know it works",
      "shared-learning": "Learning from and with each other",
      "shared-decisions": "Making decisions together",
      adaptation: "Making outside ideas our own"
    }
  };
  const criterionTitle = item => guidanceVersion?.value === "student" ? studentCriterionTitles[label]?.[item.id] || item.title : item.title;
  const guidanceDescription = description => {
    if (typeof description === "string") return escapeText(description);
    if (Array.isArray(description)) return `<ul class="rubric-guidance-bullets">${description.map(point => `<li>${escapeText(point)}</li>`).join("")}</ul>`;
    if (description && typeof description === "object") return `${description.text ? `<p>${escapeText(description.text)}</p>` : ""}${Array.isArray(description.bullets) ? `<ul class="rubric-guidance-bullets">${description.bullets.map(point => `<li>${escapeText(point)}</li>`).join("")}</ul>` : ""}`;
    return "";
  };
  get("rubric-criteria").innerHTML = sections.map((section, index) => `<fieldset class="rubric-group"><legend><span class="rubric-section-title">${escapeText(sectionTitle(section))}</span> <span id="${prefix}-section-${index}"></span></legend>${Rubric.criteria.filter(item => item.section === section).map(item => {
    const questions = item.questions?.length ? `<details class="rubric-sample-questions"><summary>Sample questions</summary><ul>${item.questions.map(question => `<li>${escapeText(question)}</li>`).join("")}</ul></details>` : "";
    return `<div class="rubric-criterion"><div class="rubric-criterion-heading"><div class="rubric-title-line"><label for="${prefix}-score-${item.id}">${escapeText(criterionTitle(item))}</label>${questions}<span class="rubric-previous-score" id="${prefix}-previous-score-${item.id}" hidden></span><span class="rubric-previous-note-wrap"><button type="button" class="rubric-previous-note-toggle" id="${prefix}-previous-note-toggle-${item.id}" data-previous-note="${prefix}-previous-${item.id}" aria-controls="${prefix}-previous-${item.id}" aria-expanded="false" aria-label="Show earlier note for ${escapeText(criterionTitle(item))}" hidden>Earlier note</button><span class="rubric-previous" id="${prefix}-previous-${item.id}" role="note" hidden></span></span></div></div><input type="hidden" id="${prefix}-score-${item.id}" value=""><div class="rubric-guidance" id="${prefix}-guidance-${item.id}"></div><label class="rubric-feedback">Evidence / notes<textarea id="${prefix}-note-${item.id}" aria-label="Evidence and notes for ${escapeText(criterionTitle(item))}" maxlength="2000" rows="2"></textarea></label></div>`;
  }).join("")}</fieldset>`).join("");
  function syncGuidanceSelection() {
    get("rubric-criteria").querySelectorAll(".rubric-guidance-option").forEach(option => {
      const points = document.getElementById(option.dataset.guidanceFor)?.value || "";
      option.setAttribute("aria-pressed", String(points === option.dataset.guidanceScore));
    });
  }
  const renderGuidance = () => {
    const student = guidanceVersion?.value === "student";
    const guidanceSet = student ? globalThis.RubricGuidance[`${label}Student`] : globalThis.RubricGuidance[label];
    get("rubric-criteria").querySelectorAll(".rubric-section-title").forEach((heading, index) => { heading.textContent = sectionTitle(sections[index]); });
    for (const item of Rubric.criteria) {
      get("rubric-criteria").querySelector(`label[for="${prefix}-score-${item.id}"]`).textContent = criterionTitle(item);
      get(`rubric-previous-note-toggle-${item.id}`).setAttribute("aria-label", `Show earlier note for ${criterionTitle(item)}`);
      get(`${prefix}-note-${item.id}`).setAttribute("aria-label", `Evidence and notes for ${criterionTitle(item)}`);
      const guidanceElement = get(`rubric-guidance-${item.id}`);
      const guidance = guidanceSet[item.id];
      guidanceElement.innerHTML = `<ul class="rubric-guidance-levels" style="--rating-count:${ratings.length}">${[...ratings].reverse().map(score => { const index = score - Rubric.minimum; return `<li><button type="button" class="rubric-guidance-option" data-guidance-for="${prefix}-score-${item.id}" data-guidance-score="${score}" aria-pressed="false"><span class="rubric-guidance-level-label"><span class="rubric-guidance-score">${score}</span></span><div class="rubric-guidance-description">${guidanceDescription(guidance[index])}</div></button></li>`; }).join("")}</ul>`;
    }
    syncGuidanceVisibility();
    syncGuidanceSelection();
  };
  renderGuidance();
  guidanceVersion?.addEventListener("change", () => { renderGuidance(); renderHistory(); });
  get("rubric-criteria").addEventListener("click", event => {
    const noteToggle = event.target.closest("[data-previous-note]");
    if (noteToggle) {
      const note = document.getElementById(noteToggle.dataset.previousNote);
      if (!note) return;
      note.hidden = !note.hidden;
      noteToggle.setAttribute("aria-expanded", String(!note.hidden));
      return;
    }
    if (!event.target.closest(".rubric-previous-note-wrap")) get("rubric-criteria").querySelectorAll("[data-previous-note][aria-expanded='true']").forEach(button => {
      const note = document.getElementById(button.dataset.previousNote);
      if (note) note.hidden = true;
      button.setAttribute("aria-expanded", "false");
    });
    const option = event.target.closest("[data-guidance-for]");
    if (!option) return;
    const points = document.getElementById(option.dataset.guidanceFor);
    if (!points) return;
    points.value = points.value === option.dataset.guidanceScore ? "" : option.dataset.guidanceScore;
    points.dispatchEvent(new Event("input", { bubbles: true }));
  });

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
    syncGuidanceSelection();
  }

  // Shows each criterion's earlier result (excluding the review being edited) as a reference for this review.
  function previous() {
    const result = selected ? Rubric.current(entries(), selected, editing) : null;
    for (const { id } of Rubric.criteria) {
      const item = result && result.criteria[id];
      const score = get(`rubric-previous-score-${id}`);
      const noteToggle = get(`rubric-previous-note-toggle-${id}`);
      const note = get(`rubric-previous-${id}`);
      const hasScore = item?.score !== null && item?.score !== undefined;
      const hasNote = Boolean(item?.note?.trim());
      score.textContent = hasScore ? `Previous: ${item.score}/${Rubric.maximum}` : "";
      score.hidden = !hasScore;
      noteToggle.hidden = !hasNote;
      noteToggle.setAttribute("aria-expanded", "false");
      note.textContent = hasNote ? `Earlier note (${item.notedOn}): ${item.note}` : "";
      note.hidden = true;
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
        return `<li class="${note ? "" : "no-note"}"><div class="review-criterion">${escapeText(criterionTitle(item))}${badge}</div>${note ? `<p>${escapeText(note)}</p>` : ""}</li>`;
      }).join("");
      return `<section><h4>${escapeText(sectionTitle(section))}<span>${points} / ${items.length * Rubric.maximum}</span></h4><ul>${rows}</ul></section>`;
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
      const canExpandNotes = accessRole() !== "viewer";
      const panel = canExpandNotes && open ? `<tr class="review-notes-row"><td colspan="5">${details(entry)}</td></tr>` : "";
      const actions = canManage(entry) ? `<button type="button" data-review-edit="${escapeText(entry.id)}" aria-label="Edit ${label} review from ${when}"${disabled}>Edit</button><button type="button" data-review-delete="${escapeText(entry.id)}" aria-label="Delete ${label} review from ${when}"${disabled}>Delete</button>` : "";
      return `<tr class="${open ? "notes-open" : ""}"><td>${when}${entry.id === editing ? " (editing)" : ""}</td><td>${escapeText(entry.reviewer)}<small>${entry.reviewRole === "member" ? "Student review (not ranked)" : "Coach review"}</small></td><td>${points.total}</td><td>${points.scored} / ${count}</td><td><div class="review-row-actions">${canExpandNotes ? toggle : ""}${actions}</div></td></tr>${panel}`;
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
  const controller = { render: renderRubric, reset: () => { selected = null; editing = null; changed = false; renderRubric(); load(); }, isDirty: () => changed };
  renderRubric();
  return controller;
  }
  globalThis.RubricUI = createUI(globalThis.NotebookRubric, "rubrics", "rubric", "notebook");
  globalThis.InterviewUI = createUI(globalThis.InterviewRubric, "interviews", "interview", "interview");
})();
