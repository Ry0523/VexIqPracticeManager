/** Access-list editor. Apps Script remains authoritative for all permission checks. */
(function () {
  "use strict";
  // Shared access list. V5 uses one editor permission; IQ retains coach and team-member roles.
  /**
   * Returns matching page element.
   *
   * @param {string} id - Required access-view element ID.
   * @returns {HTMLElement} Matching page element.
   */
  const get = (id) => document.getElementById(id);
  /**
   * Returns whether the active game uses the unified V5 editor role.
   *
   * @returns {boolean} Whether the active game uses the unified V5 editor role.
   */
  const v5Access = () => globalThis.VexGame?.active?.program === "VEX V5";
  /**
   * Labels for roles in the active game.
   *
   * @returns {Record<"coach"|"member", string>} Labels for roles in the active game.
   */
  const roleNames = () =>
    v5Access() ? { coach: "Editor", member: "Editor" } : { coach: "Coach", member: "Team member" };
  /**
   * @type {import("./types").AccessEntry[]|null} null until the list is loaded.
   */
  let entries = null;
  /**
   * @type {{owner: string, domain: string}} Server-provided owner and editor-domain labels.
   */
  let info = { owner: "", domain: "" };
  let busy = false;
  let editingEmail = null;

  /**
   * Returns whether this shared-app coach may manage access.
   *
   * @returns {boolean} Whether this shared-app coach may manage access.
   */
  const allowed = () => globalThis.EventStorage?.shared && globalThis.EventStorage.access?.role === "coach";
  /**
   * Updates the access status text.
   *
   * @param {string} text - Status or error message to display.
   * @returns {void} Updates the access status text.
   */
  const status = (text) => {
    get("access-status").textContent = text;
  };

  /**
   * Renders roles, team options, access rows, and busy-state controls.
   *
   * @returns {void} Renders roles, team options, access rows, and busy-state controls.
   */
  function render() {
    const unified = v5Access();
    get("access-owner").textContent = info.owner || "the account that deployed the app";
    const domainLabel = get("access-domain");
    if (domainLabel) domainLabel.textContent = info.domain ? `@${info.domain}` : "district";
    if (info.domain) get("access-email").placeholder = `name@${info.domain}`;
    get("access-role").closest("label").hidden = unified;
    get("access-role").value = unified ? "coach" : get("access-role").value;
    const headers = get("access-rows").closest("table").querySelectorAll("thead th");
    headers[2].hidden = unified;
    const roster = new Map(state.teams.map((team) => [team.id, team.name]));
    const ids = [
      ...new Set([
        ...roster.keys(),
        /**
         * Renders roles, team options, access rows, and busy-state controls.
         *
         * @returns {void} Renders roles, team options, access rows, and busy-state controls.
         */
        ...(entries || []).filter((entry) => entry.team).map((entry) => entry.team),
      ]),
    ];
    const select = get("access-team");
    const previous = select.value;
    select.innerHTML = `${unified ? '<option value="">No default team</option>' : ""}${ids.map((id) => `<option value="${escapeText(id)}">${escapeText(id)}${roster.has(id) ? ` / ${escapeText(roster.get(id))}` : " (not on roster)"}</option>`).join("") || (unified ? "" : '<option value="">Add teams first</option>')}`;
    if (ids.includes(previous)) select.value = previous;
    const member = !unified && get("access-role").value === "member";
    select.disabled = busy || (!unified && !member) || (!ids.length && !unified);
    for (const id of ["access-name", "access-email", "access-role", "save-access", "cancel-access-edit"])
      get(id).disabled = busy || entries === null;
    get("save-access").textContent = editingEmail
      ? unified
        ? "Update editor"
        : "Save changes"
      : unified
        ? "Add editor"
        : "Add or update";
    get("cancel-access-edit").hidden = editingEmail === null;
    const sorted = [...(entries || [])].sort(
      (a, b) =>
        (a.role === b.role ? 0 : a.role === "coach" ? -1 : 1) ||
        a.team.localeCompare(b.team, "en", { numeric: true }) ||
        (a.name || a.email).localeCompare(b.name || b.email) ||
        a.email.localeCompare(b.email),
    );
    const ownerRow = info.owner
      ? `<tr><td>App owner</td><td>${escapeText(info.owner)}</td><td>${unified ? "Editor (app owner)" : "Coach (app owner)"}</td><td>All teams</td><td></td></tr>`
      : "";
    get("access-rows").innerHTML =
      ownerRow +
        sorted
          .map(
            (entry) =>
              `<tr><td>${escapeText(entry.name || entry.email)}</td><td>${escapeText(entry.email)}</td><td>${roleNames()[entry.role]}</td><td>${unified ? (entry.team ? `${escapeText(entry.team)}${roster.has(entry.team) ? ` / ${escapeText(roster.get(entry.team))}` : " (not on roster)"}` : "No default team") : entry.role === "member" ? `${escapeText(entry.team)}${roster.has(entry.team) ? "" : " (not on roster)"}` : "All teams"}</td><td><button type="button" data-access-edit="${escapeText(entry.email)}" aria-label="Edit ${escapeText(entry.email)}"${busy ? " disabled" : ""}>Edit</button><button type="button" data-access-remove="${escapeText(entry.email)}" aria-label="Remove ${escapeText(entry.email)}"${busy ? " disabled" : ""}>Remove</button></td></tr>`,
          )
          .join("") ||
      (entries === null
        ? ""
        : `<tr><td colspan="${unified ? 3 : 5}">${unified ? "No editors added yet." : "No coaches or team members added yet."}</td></tr>`);
  }

  /**
   * Loads access data from the server and renders it when allowed.
   *
   * @returns {Promise<void>} Loads access data from the server and renders it when allowed.
   */
  async function open() {
    if (!allowed() || busy) return;
    busy = true;
    status("Loading the access list...");
    render();
    try {
      const response = await globalThis.EventStorage.loadAccess();
      entries = response.entries;
      info = { owner: response.owner, domain: response.domain };
      status("");
    } catch (error) {
      status(`Could not load the access list: ${error.message}`);
    } finally {
      busy = false;
      render();
    }
  }

  /**
   * Saves the complete access list through the server and reports the result.
   * @param {import("./types").AccessEntry[]} next Normalized rows to save.
   * @param {string} message Success notification.
   * @returns {Promise<boolean>} Whether the save succeeded.
   */
  async function store(next, message) {
    busy = true;
    status("Saving the access list...");
    render();
    try {
      const response = await globalThis.EventStorage.saveAccess(next);
      entries = response.entries;
      info = { owner: response.owner, domain: response.domain };
      status("");
      notify(message);
      return true;
    } catch (error) {
      status("");
      notify(`Access list not saved: ${error.message}`);
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  get("access-role").addEventListener("change", render);
  get("cancel-access-edit").addEventListener("click", () => {
    editingEmail = null;
    get("access-name").value = "";
    get("access-email").value = "";
    get("access-role").value = v5Access() ? "coach" : "member";
    render();
  });
  get("access-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || entries === null) return;
    const name = get("access-name").value.trim();
    const email = get("access-email").value.trim().toLowerCase();
    const unified = v5Access();
    const role = unified ? "coach" : get("access-role").value;
    const team = unified || role === "member" ? get("access-team").value : "";
    if (info.domain && !email.endsWith(`@${info.domain}`)) {
      notify(
        `Only @${info.domain} accounts can be added. Google does not share other accounts' emails with the app.`,
      );
      return;
    }
    if (!unified && role === "member" && !team) {
      notify("Add the team in Teams & schedule before adding its members.");
      return;
    }
    const existing = entries.some((entry) => entry.email === email || entry.email === editingEmail);
    const next = [
      ...entries.filter((entry) => entry.email !== email && entry.email !== editingEmail),
      { name, email, role, team },
    ];
    const description = unified
      ? `an editor${team ? ` with ${team} as the default team` : ""}`
      : role === "coach"
        ? "a coach"
        : `a team ${team} member`;
    if (await store(next, `${email} ${existing ? "updated" : "added"} as ${description}.`)) {
      editingEmail = null;
      get("access-name").value = "";
      get("access-email").value = "";
      get("access-role").value = unified ? "coach" : "member";
      render();
    }
  });
  get("access-rows").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-access-edit]");
    if (edit && !busy && entries !== null) {
      const entry = entries.find((item) => item.email === edit.dataset.accessEdit);
      if (!entry) return;
      editingEmail = entry.email;
      get("access-name").value = entry.name || "";
      get("access-email").value = entry.email;
      get("access-role").value = v5Access() ? "coach" : entry.role;
      if (v5Access() || entry.role === "member") get("access-team").value = entry.team || "";
      render();
      get("access-name").focus();
      return;
    }
    const button = event.target.closest("[data-access-remove]");
    if (!button || busy || entries === null) return;
    const email = button.dataset.accessRemove;
    if (
      !(await ask(
        `Remove ${email}? They will see read-only results from their next load or save.`,
        "Remove access",
        true,
      ))
    )
      return;
    if (editingEmail === email) editingEmail = null;
    store(
      entries.filter((entry) => entry.email !== email),
      `${email} removed.`,
    );
  });

  /**
   * @type {import("./types").AccessUIController} Access-management API consumed by app.js.
   */
  globalThis.AccessUI = { open, render };
})();
