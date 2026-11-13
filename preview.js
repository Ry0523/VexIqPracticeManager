(function () {
  "use strict";
  // Local-only role preview: runs the real app against a stand-in for the shared Apps Script backend so a coach
  // can see what a team member or viewer gets without a second Google account. It reads this browser's local
  // event, applies the server's own redaction and member-save rules from apps-script/Code.gs, and keeps every
  // change in memory: the local event is never modified. Not part of the Apps Script build.
  const params = new URLSearchParams(location.search);
  const role = params.get("role");
  const domain = "nu-district.org";
  const sample = params.get("data") === "sample";
  const SAMPLE_TEAMS = [
    ["1A", "Sample Sparks"],
    ["2B", "Gear Grinders"],
    ["3C", "Pixel Pilots"],
    ["4D", "Bolt Brigade"],
    ["5E", "Circuit Squad"],
    ["6F", "Torque Team"],
  ];

  // A small event with posted matches, skills, practice, robots, and reviews for the first two teams, built with the
  // app's own models so it always matches the current data format.
  /**
   * Returns validated sample event used by the local role preview.
   *
   * @returns {import("./types").EventState} Validated sample event used by the local role preview.
   */
  function sampleEvent() {
    const { EventRules: Core, ScoreHistory: History, NotebookRubric: Rubric, EventModel } = globalThis;
    const teams = SAMPLE_TEAMS.map(([id, name], draw) => ({ id, name, draw }));
    const event = EventModel.validate({
      version: 1,
      sessionId: History.newId(),
      history: [],
      name: "Sample event",
      teams,
      matches: [],
      skills: [],
      skillsOnly: false,
      rounds: 4,
      start: "09:00",
      interval: 3,
      selected: null,
    });
    let seed = 7;
    /**
     * Produces the next deterministic pseudo-random sample value.
     *
     * @returns {number} Next value in the sample sequence.
     */
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    event.matches = Core.schedule(teams, 4, random);
    event.matches.slice(0, 6).forEach((match, index) => {
      const counts = [2 + (index % 3), index % 2, 1, 0, index % 2];
      match.result = {
        counts,
        goals: Core.goalsFromCounts(counts),
        statuses: Object.fromEntries(match.teams.map((team) => [team, "ok"])),
      };
      event.history.push(History.capture(event, "teamwork", match, "posted"));
    });
    event.skills = teams.slice(0, 3).map((team, index) => ({
      team: team.id,
      mode: "driver",
      attempt: 1,
      status: "ok",
      counts: [3 - index, 1, 0, 0, 0],
      optIn: false,
      stopTime: 0,
    }));
    for (const skill of event.skills) event.history.push(History.capture(event, "skills", skill, "posted"));
    event.history.push(
      History.practiceRecord(event.history, teams, {
        mode: "driver",
        teams: ["1A"],
        goals: Core.goalsFromCounts([3, 1, 0, 0, 0]),
        occurredAt: "2026-10-20T15:30:00.000Z",
        notes: "Sample practice note",
        status: "ok",
        optIn: false,
        stopTime: 0,
      }),
    );
    event.robots = teams.slice(0, 2).map((team, index) => ({
      id: `sample-robot-${index}`,
      team: team.id,
      name: "Competition robot v1",
      startedAt: "2026-10-01T12:00:00.000Z",
      notes: `Sample design note for ${team.id}`,
    }));
    /**
     * Adds a sample review for a team using the selected rubric.
     *
     * @param {import("./types").RubricModel} rubric Rubric model to use.
     * @param {import("./types").ReviewEvaluation[]} list Existing reviews.
     * @param {Pick<import("./types").Team, "id" | "name">} team Reviewed team.
     * @param {string} date Evaluation date.
     * @param {string} reviewer Reviewer name.
     * @param {number} score Offset used to generate sample ratings.
     * @returns {import("./types").ReviewEvaluation[]} Updated review history.
     */
    const review = (rubric, list, team, date, reviewer, score) =>
      rubric.save(list, team, {
        evaluatedOn: date,
        reviewer,
        overallNotes: `Sample overall feedback for ${team.id}`,
        scores: Object.fromEntries(
          rubric.criteria.map(({ id }, index) => [
            id,
            rubric.minimum + ((score + index) % (rubric.maximum - rubric.minimum + 1)),
          ]),
        ),
        notes: Object.fromEntries(
          rubric.criteria.map(({ id }, index) => [id, index < 2 ? `Sample note for ${team.id}` : ""]),
        ),
      });
    for (const team of teams.slice(0, 2)) {
      event.rubrics = review(Rubric, event.rubrics || [], team, "2026-10-08", "Coach Sample", 1);
      event.rubrics = review(Rubric, event.rubrics, team, "2026-10-15", "Coach Sample", 2);
      event.interviews = review(
        Rubric.Interview,
        event.interviews || [],
        team,
        "2026-10-15",
        "Coach Sample",
        2,
      );
    }
    return EventModel.validate(event);
  }

  /**
   * Locally saved event, or undefined when unavailable.
   *
   * @returns {Promise<import("./types").EventState|undefined>} Locally saved event, or undefined when unavailable.
   */
  function readLocalEvent() {
    return new Promise((resolve) => {
      const request = indexedDB.open("level-up-match-manager", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("events");
      request.onerror = () => resolve(undefined);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("events", "readonly").objectStore("events").get("current");
        read.onsuccess = () => {
          db.close();
          resolve(read.result);
        };
        read.onerror = () => {
          db.close();
          resolve(undefined);
        };
      };
    });
  }

  /**
   * HTML-escaped text.
   *
   * @param {unknown} text - Text to render in preview chrome.
   * @returns {string} HTML-escaped text.
   */
  const escapeHtml = (text) =>
    String(text).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

  /**
   * Renders the role/data/team selection screen.
   *
   * @returns {Promise<void>} Renders the role/data/team selection screen.
   */
  async function chooser() {
    const event = await readLocalEvent();
    const localTeams = event?.teams || [];
    const sampleTeams = SAMPLE_TEAMS.map(([id, name]) => ({ id, name }));
    document.title = "Role preview | Local Match Manager";
    document.body.innerHTML = `<main style="font-family:system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;line-height:1.5">
      <h1>Preview the shared app as another role</h1>
      <p>Nothing you do in the preview is saved.</p>
      <form method="get" style="display:grid;gap:.75rem">
        <label>Data <select name="data" id="preview-data"><option value="sample">Sample event (6 teams, scores, and reviews)</option><option value="local"${localTeams.length ? "" : " disabled"}>My local event${localTeams.length ? ` (${localTeams.length} teams)` : " (no teams yet)"}</option></select></label>
        <label>Role <select name="role" id="preview-role"><option value="member">Team member (student)</option><option value="viewer">Read-only viewer</option><option value="coach">Coach</option></select></label>
        <label>Team <select name="team" id="preview-team"></select></label>
        <button type="submit">Open preview</button>
      </form>
      <p><a href="index.html">Back to the app</a></p>
    </main>`;
    /**
     * Updates team options and enabled state from current role/data choices.
     *
     * @returns {void} Updates team options and enabled state from current role/data choices.
     */
    const sync = () => {
      const teams = document.getElementById("preview-data").value === "sample" ? sampleTeams : localTeams;
      const select = document.getElementById("preview-team");
      const previous = select.value;
      select.innerHTML = teams
        .map(
          (team) =>
            `<option value="${escapeHtml(team.id)}">${escapeHtml(team.id)} / ${escapeHtml(team.name)}</option>`,
        )
        .join("");
      if (teams.some((team) => team.id === previous)) select.value = previous;
      select.disabled = document.getElementById("preview-role").value !== "member";
    };
    document.getElementById("preview-role").addEventListener("change", sync);
    document.getElementById("preview-data").addEventListener("change", sync);
    sync();
  }

  /**
   * Runs the app against an in-memory stand-in for Apps Script.
   *
   * @returns {Promise<void>} Runs the app against an in-memory stand-in for Apps Script.
   */
  async function preview() {
    const team = role === "member" ? String(params.get("team") || "").toUpperCase() : "";
    const access = {
      canEdit: role !== "viewer",
      role,
      team,
      email: role === "coach" ? `coach-preview@${domain}` : `preview-${role}@${domain}`,
      domain,
    };
    const [page, code] = await Promise.all([
      fetch("index.html").then((response) => response.text()),
      fetch("apps-script/Code.gs").then((response) => response.text()),
    ]);
    const server = new Function(`${code}\nreturn { eventCopy_, memberSave_, memberChanges_ };`)();
    let stored = sample ? null : await readLocalEvent();
    let revision = 1;
    let accessList = [];
    let normalized = false;
    const api = {
      loadEventJson() {
        if (!normalized) {
          stored = sample ? sampleEvent() : stored ? globalThis.EventModel.validate(stored) : null;
          normalized = true;
        }
        return JSON.stringify({ ok: true, revision, event: server.eventCopy_(stored, access), access });
      },
      eventRevisionJson: () => JSON.stringify({ ok: true, revision }),
      // Refusals come back as REFUSED, like the real server, so the page does not retry them.
      saveEventJson(json) {
        try {
          return save(json);
        } catch (error) {
          return JSON.stringify({ ok: false, code: "REFUSED", message: error.message });
        }
      },
      saveChangesJson(json) {
        try {
          return saveChanges(json);
        } catch (error) {
          return JSON.stringify({ ok: false, code: "REFUSED", message: error.message });
        }
      },
      loadAccessJson() {
        if (role !== "coach") throw new Error("Only coaches can view the access list.");
        return JSON.stringify({ ok: true, owner: `owner@${domain}`, domain, entries: accessList });
      },
      saveAccessJson(json) {
        if (role !== "coach") throw new Error("Only coaches can change the access list.");
        accessList = JSON.parse(json).entries;
        return JSON.stringify({ ok: true, owner: `owner@${domain}`, domain, entries: accessList });
      },
    };
    /**
     * Returns serialized success or conflict response.
     *
     * @param {string} json - Serialized full-event save request.
     * @returns {string} Serialized success or conflict response.
     */
    function save(json) {
      if (!access.canEdit)
        throw new Error(
          `Read-only access: ${access.email} is not on the app's access list. Ask a coach to add you.`,
        );
      const request = JSON.parse(json);
      let candidate = globalThis.EventModel.validate(request.event);
      if (request.revision !== revision)
        return JSON.stringify({
          ok: false,
          code: "CONFLICT",
          message:
            "Another operator saved a newer event. Export your pending changes, then reload shared data.",
        });
      if (role === "member") candidate = server.memberSave_(stored, candidate, team, access.email);
      if (stored) {
        const history = new Map(candidate.history.map((record) => [record.id, record]));
        for (const record of stored.history)
          if (!history.has(record.id) || JSON.stringify(history.get(record.id)) !== JSON.stringify(record))
            throw new Error("Shared score history cannot be deleted or rewritten.");
      }
      stored = candidate;
      revision += 1;
      return JSON.stringify({ ok: true, revision });
    }
    /**
     * Returns serialized success or conflict response.
     *
     * @param {string} json - Serialized change-set save request.
     * @returns {string} Serialized success or conflict response.
     */
    function saveChanges(json) {
      if (!access.canEdit)
        throw new Error(
          `Read-only access: ${access.email} is not on the app's access list. Ask a coach to add you.`,
        );
      const { changes } = JSON.parse(json);
      if (role === "member") server.memberChanges_(stored, changes, access.email);
      const merged = globalThis.EventChanges.apply(stored, changes);
      if (merged.conflicts.length)
        return JSON.stringify({
          ok: false,
          code: "CONFLICT",
          message: `Another operator changed ${merged.conflicts.join(", ")} at the same time. Reload shared data.`,
        });
      stored = globalThis.EventModel.validate(JSON.parse(JSON.stringify(merged.event)));
      revision += 1;
      return JSON.stringify({ ok: true, previous: revision - 1, revision });
    }
    const run = {
      withSuccessHandler: (success) => ({
        withFailureHandler: (failure) =>
          new Proxy(
            {},
            {
              get: (_, method) => (argument) =>
                setTimeout(() => {
                  try {
                    success(api[method](argument));
                  } catch (error) {
                    failure(error);
                  }
                }, 50),
            },
          ),
      }),
    };
    globalThis.google = { script: { run } };

    const source = new DOMParser().parseFromString(page, "text/html");
    const scripts = [...source.querySelectorAll("script[src]")].map((script) => script.getAttribute("src"));
    source.querySelectorAll("script").forEach((script) => script.remove());
    document.head.innerHTML = source.head.innerHTML;
    document.body.className = source.body.className;
    document.body.innerHTML = source.body.innerHTML;
    const label = `${role === "member" ? `Team ${team} member` : role === "viewer" ? "read-only viewer" : "coach"}${sample ? " (sample event)" : ""}`;
    const banner = document.createElement("div");
    banner.setAttribute("role", "status");
    banner.style.cssText =
      "position:sticky;top:0;z-index:1000;background:#7a3e00;color:#fff;padding:.4rem .75rem;font:600 .9rem system-ui,sans-serif;display:flex;gap:1rem;justify-content:space-between;align-items:center";
    banner.innerHTML = `<span>Preview as ${escapeHtml(label)}. Changes stay in this tab and are never saved.</span><span><a href="preview.html" style="color:#fff">Change role</a> &nbsp; <a href="index.html" style="color:#fff">Exit preview</a></span>`;
    document.body.prepend(banner);
    for (const src of scripts) {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      document.body.append(script);
    }
  }

  /**
   * Opens the chooser or role preview and surfaces startup errors in the page.
   *
   * @returns {Promise<void>} Opens the chooser or role preview and surfaces startup errors in the page.
   */
  const start = () =>
    (role === "member" || role === "viewer" || role === "coach" ? preview() : chooser()).catch((error) => {
      document.body.textContent = `Preview failed: ${error.message}`;
    });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
