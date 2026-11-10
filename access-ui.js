(function () {
  "use strict";
  // Coach-only access list for the shared app (Settings > Manage access): who can score (team members) and who has full access (coaches).
  const get = id => document.getElementById(id);
  const ROLE_NAMES = { coach: "Coach", member: "Team member" };
  let entries = null;
  let info = { owner: "", domain: "" };
  let busy = false;

  const allowed = () => globalThis.EventStorage?.shared && globalThis.EventStorage.access?.role === "coach";
  const status = text => { get("access-status").textContent = text; };

  function render() {
    get("access-owner").textContent = info.owner || "the account that deployed the app";
    get("access-domain").textContent = info.domain ? `@${info.domain}` : "district";
    if (info.domain) get("access-email").placeholder = `name@${info.domain}`;
    const roster = new Map(state.teams.map(team => [team.id, team.name]));
    const ids = [...new Set([...roster.keys(), ...(entries || []).filter(entry => entry.team).map(entry => entry.team)])];
    const select = get("access-team");
    const previous = select.value;
    select.innerHTML = ids.map(id => `<option value="${escapeText(id)}">${escapeText(id)}${roster.has(id) ? ` / ${escapeText(roster.get(id))}` : " (not on roster)"}</option>`).join("") || '<option value="">Add teams first</option>';
    if (ids.includes(previous)) select.value = previous;
    const member = get("access-role").value === "member";
    select.disabled = busy || !member || !ids.length;
    for (const id of ["access-name", "access-email", "access-role", "save-access"]) get(id).disabled = busy || entries === null;
    const sorted = [...(entries || [])].sort((a, b) => (a.role === b.role ? 0 : a.role === "coach" ? -1 : 1) || a.team.localeCompare(b.team, "en", { numeric: true }) || (a.name || a.email).localeCompare(b.name || b.email) || a.email.localeCompare(b.email));
    const ownerRow = info.owner ? `<tr><td>App owner</td><td>${escapeText(info.owner)}</td><td>Coach (app owner)</td><td>All teams</td><td></td></tr>` : "";
    get("access-rows").innerHTML = ownerRow + sorted.map(entry => `<tr><td>${escapeText(entry.name || entry.email)}</td><td>${escapeText(entry.email)}</td><td>${ROLE_NAMES[entry.role]}</td><td>${entry.role === "member" ? `${escapeText(entry.team)}${roster.has(entry.team) ? "" : " (not on roster)"}` : "All teams"}</td><td><button type="button" data-access-remove="${escapeText(entry.email)}" aria-label="Remove ${escapeText(entry.email)}"${busy ? " disabled" : ""}>Remove</button></td></tr>`).join("")
      || (entries === null ? "" : '<tr><td colspan="5">No coaches or team members added yet.</td></tr>');
  }

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
    } catch (error) { status(`Could not load the access list: ${error.message}`); }
    finally { busy = false; render(); }
  }

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
    } finally { busy = false; render(); }
  }

  get("access-role").addEventListener("change", render);
  get("access-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || entries === null) return;
    const name = get("access-name").value.trim();
    const email = get("access-email").value.trim().toLowerCase();
    const role = get("access-role").value;
    const team = role === "member" ? get("access-team").value : "";
    if (info.domain && !email.endsWith(`@${info.domain}`)) { notify(`Only @${info.domain} accounts can be added. Google does not share other accounts' emails with the app.`); return; }
    if (role === "member" && !team) { notify("Add the team in Teams & schedule before adding its members."); return; }
    const existing = entries.some(entry => entry.email === email);
    const next = [...entries.filter(entry => entry.email !== email), { name, email, role, team }];
    if (await store(next, `${email} ${existing ? "updated" : "added"} as ${role === "coach" ? "a coach" : `a team ${team} member`}.`)) { get("access-name").value = ""; get("access-email").value = ""; }
  });
  get("access-rows").addEventListener("click", async event => {
    const button = event.target.closest("[data-access-remove]");
    if (!button || busy || entries === null) return;
    const email = button.dataset.accessRemove;
    if (!(await ask(`Remove ${email}? They will see read-only results from their next load or save.`, "Remove access", true))) return;
    store(entries.filter(entry => entry.email !== email), `${email} removed.`);
  });

  globalThis.AccessUI = { open, render };
})();
