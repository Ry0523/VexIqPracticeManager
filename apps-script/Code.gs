function doGet() {
  const output = HtmlService.createHtmlOutputFromFile("Index")
    .setTitle(`${globalThis.VexGame ? globalThis.VexGame.active.name : "VEX IQ"} | Shared Match Manager`);
  const faviconUrl = PropertiesService.getScriptProperties().getProperty("FAVICON_URL");
  if (faviconUrl) {
    try {
      output.setFaviconUrl(faviconUrl);
    } catch (error) {
      console.warn(`Custom favicon could not be configured; using the default icon: ${error.message}`);
    }
  }
  return output;
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Set the SPREADSHEET_ID script property before using this app.");
  return SpreadsheetApp.openById(id);
}

function eventSheet_() {
  const sheet = spreadsheet_().getSheetByName("EventStore");
  if (!sheet) throw new Error("Create an empty sheet named EventStore in the shared spreadsheet.");
  return sheet;
}

// The app runs as its owner, so access is decided here, not by spreadsheet sharing.
// Coaches have full access. Members add practice runs and manage their own student reviews; everyone else
// gets a read-only results view.
// Google only reveals visitor emails from the owner's own Workspace domain, so the owner must belong to it.
const ACCESS_SHEET = "Access";
const ACCESS_HEADERS = ["Email", "Role", "Team", "Updated by", "Updated at (UTC)", "Name"];
const ROLES = ["coach", "member"];

function editorDomain_() {
  return String(PropertiesService.getScriptProperties().getProperty("EDITOR_DOMAIN") || "nu-district.org").trim().toLowerCase().replace(/^@/, "");
}

function normalizeAccess_(entry, domain) {
  const name = String(entry && entry.name || "").trim();
  const email = String(entry && entry.email || "").trim().toLowerCase();
  const role = String(entry && entry.role || "").trim().toLowerCase();
  const team = String(entry && entry.team || "").trim().toUpperCase();
  if (name.length > 80 || !domain || email.length > 254 || !/^[a-z0-9._%+'-]+@[a-z0-9.-]+$/.test(email) || !email.endsWith(`@${domain}`)) return null;
  if (!ROLES.includes(role)) return null;
  if (role === "member" && !/^[A-Z0-9-]{1,20}$/.test(team)) return null;
  return { name, email, role, team: role === "member" ? team : "" };
}

// Rows edited by hand in the Access sheet that are incomplete or invalid are ignored rather than blocking everyone.
function accessList_(domain) {
  const sheet = spreadsheet_().getSheetByName(ACCESS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const seen = new Set();
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues()
    .map(([email, role, team, , , name]) => normalizeAccess_({ name, email, role, team }, domain))
    .filter(entry => entry && !seen.has(entry.email) && seen.add(entry.email));
}

function access_() {
  const domain = editorDomain_();
  let email = "";
  let owner = "";
  try { email = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase(); } catch (error) { email = ""; }
  try { owner = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase(); } catch (error) { owner = ""; }
  let role = "viewer";
  let team = "";
  if (domain && email.endsWith(`@${domain}`)) {
    if (email === owner) role = "coach";
    else {
      const entry = accessList_(domain).find(item => item.email === email);
      if (entry) { role = entry.role; team = entry.team; }
    }
  }
  return { email, domain, owner, role, team, canEdit: role !== "viewer" };
}

function publicAccess_(access) {
  return { canEdit: access.canEdit, role: access.role, team: access.team, email: access.email, domain: access.domain, isOwner: access.role === "coach" && access.email === access.owner };
}

const blankFeedback_ = entry => ({ ...entry, ...(entry.authorEmail !== undefined ? { authorEmail: "" } : {}), reviewer: "", overallNotes: "", notes: Object.fromEntries(Object.keys(entry.notes).map(id => [id, ""])) });

// Viewers see results only: coaching text (rubric notes, reviewers, practice and robot notes) never leaves the server.
function viewerCopy_(event) {
  if (!event) return event;
  return {
    ...event,
    rubrics: event.rubrics.map(blankFeedback_),
    interviews: event.interviews.map(blankFeedback_),
    robots: event.robots.map(robot => ({ ...robot, notes: "" })),
    history: event.history.map(record => typeof record.notes === "string" ? { ...record, notes: "" } : record)
  };
}

// Members read feedback for their team and reviews they authored. Other feedback and author identities are redacted.
function memberCopy_(event, team, email = "") {
  if (!event) return event;
  const own = entry => entry.team.id === team || (entry.reviewRole === "member" && email && entry.authorEmail === email) ? entry : blankFeedback_(entry);
  return { ...event, rubrics: event.rubrics.map(own), interviews: event.interviews.map(own) };
}

// Coaches get the full event.
function eventCopy_(event, access) {
  return access.role === "viewer" ? viewerCopy_(event) : access.role === "member" ? memberCopy_(event, access.team, access.email) : event;
}

function stable_(value) {
  if (Array.isArray(value)) return `[${value.map(stable_).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable_(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const MEMBER_LOCKED = { name: "the event name", game: "the game", sessionId: "the session", teams: "the team roster", rounds: "the schedule", start: "the schedule", interval: "the schedule", skillsOnly: "the event type", finalsWithdrawn: "finals withdrawals", robots: "robot versions" };

function memberReviewChange_(stored, change, email) {
  const label = change.key === "rubrics" ? "notebook reviews" : "interview reviews";
  const deny = () => { throw new Error(`You may only add or change your own student ${label}. Coach reviews require coach access.`); };
  const previous = stored[change.key].find(entry => entry.id === change.id);
  const owns = entry => entry && entry.reviewRole === "member" && email && entry.authorEmail === email;
  if (previous && !owns(previous)) deny();
  const next = change.after;
  if (next === null) {
    if (!owns(previous || change.before)) deny();
    return;
  }
  if (!owns(next) || next.id !== change.id) deny();
  if (previous && (stable_(next.team) !== stable_(previous.team) || next.game !== previous.game || next.createdAt !== previous.createdAt)) deny();
  if (!previous) {
    const teams = new Map([...stored.rubrics, ...stored.interviews].map(entry => [entry.team.id, entry.team]));
    for (const team of stored.teams) teams.set(team.id, team);
    if (!teams.has(next.team?.id) || teams.get(next.team.id).name !== next.team.name) deny();
  }
}

const MEMBER_CORRECTION = "Coach access required to score matches or skills, or to edit or remove a practice run. Reload shared data to discard that change.";

// Members add new practice runs and manage their own student reviews. Unchanged redacted reviews are restored
// from storage, so saving never overwrites another team's private feedback.
function memberSave_(stored, candidate, team, email = "") {
  if (!stored) throw new Error("A coach must set up the event before team members can save.");
  const sent = memberCopy_(stored, team, email);
  for (const [key, label] of Object.entries(MEMBER_LOCKED)) {
    if (stable_(candidate[key]) !== stable_(sent[key])) throw new Error(`Coach access required to change ${label}. Reload shared data to discard that change.`);
  }
  const reviews = globalThis.EventChanges.diff(sent, candidate).filter(change => ["rubrics", "interviews"].includes(change.key));
  for (const change of reviews) {
    if (change.type !== "item") throw new Error("Invalid review change.");
    memberReviewChange_(stored, change, email);
  }
  const merged = globalThis.EventChanges.apply(stored, reviews);
  if (merged.conflicts.length) throw new Error("Another operator changed these reviews. Reload shared data.");
  candidate = { ...candidate, rubrics: merged.event.rubrics, interviews: merged.event.interviews };
  const layout = matches => matches.map(match => ({ ...match, result: undefined }));
  if (stable_(layout(candidate.matches)) !== stable_(layout(stored.matches)) || stable_(layout(candidate.finals)) !== stable_(layout(stored.finals))) throw new Error("Coach access required to change the schedule or finals alliances. Reload shared data to discard that change.");
  for (const key of ["matches", "finals", "skills"]) {
    if (stable_(candidate[key]) !== stable_(stored[key])) throw new Error(MEMBER_CORRECTION);
  }
  const History = globalThis.ScoreHistory;
  const known = new Set(stored.history.map(record => record.id));
  const used = recordedResults_(stored);
  for (const record of candidate.history) {
    if (known.has(record.id)) continue;
    const key = History.resultKey(record);
    if (record.source !== "practice" || record.action !== "posted" || used.has(key)) throw new Error(MEMBER_CORRECTION);
    if (record.runRole !== "member") throw new Error("Student practice runs must be marked as student runs and cannot count toward leaderboards.");
    used.add(key);
  }
  return candidate;
}

// Every result ever recorded, including removed and voided ones, so a team member cannot reuse a deleted practice run's
// identity to bring it back.
function recordedResults_(stored) {
  return new Set(stored.history.map(globalThis.ScoreHistory.resultKey));
}

// The change-based equivalent of memberSave_: selections, new practice runs, and the member's own student reviews.
function memberChanges_(stored, changes, email = "") {
  if (!stored) throw new Error("A coach must set up the event before team members can save.");
  const History = globalThis.ScoreHistory;
  const used = recordedResults_(stored);
  for (const change of changes) {
    if (change.type === "item" && ["rubrics", "interviews"].includes(change.key)) {
      memberReviewChange_(stored, change, email);
      continue;
    }
    if (change.type === "value" && globalThis.EventChanges.PERSONAL.has(change.key)) continue;
    if (change.type === "history") {
      for (const record of change.records) {
        if (!record || stored.history.some(item => item.id === record.id)) continue;
        const key = History.resultKey(record);
        if (record.source !== "practice" || record.action !== "posted" || used.has(key)) throw new Error(MEMBER_CORRECTION);
        if (record.runRole !== "member") throw new Error("Student practice runs must be marked as student runs and cannot count toward leaderboards.");
        used.add(key);
      }
      continue;
    }
    if (change.type === "value" && MEMBER_LOCKED[change.key]) throw new Error(`Coach access required to change ${MEMBER_LOCKED[change.key]}. Reload shared data to discard that change.`);
    if (["matches", "finals", "skills"].includes(change.key)) throw new Error(change.type === "order" ? "Coach access required to change the schedule or finals alliances. Reload shared data to discard that change." : MEMBER_CORRECTION);
    throw new Error(`Coach access required to change ${globalThis.EventChanges.label(change)}. Reload shared data to discard that change.`);
  }
}

// Score history is append-only: every stored record must survive unchanged in whatever is saved.
function keepsHistory_(stored, candidate) {
  if (!stored) return;
  const history = new Map(candidate.history.map(record => [record.id, record]));
  for (const record of stored.history) {
    if (!history.has(record.id) || JSON.stringify(history.get(record.id)) !== JSON.stringify(record)) throw refusal_(new Error("Shared score history cannot be deleted or rewritten."));
  }
}

function digest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(value => (value & 255).toString(16).padStart(2, "0")).join("");
}

function readEvent_(sheet) {
  const pointer = sheet.getRange(1, 1).getValue();
  if (pointer === "") return { revision: 0, event: null, bank: 3 };
  const metadata = JSON.parse(pointer);
  if (!Number.isSafeInteger(metadata.revision) || metadata.revision < 1 || ![2, 3].includes(metadata.bank) || !Number.isInteger(metadata.chunks) || metadata.chunks < 1 || metadata.chunks > 250 || typeof metadata.hash !== "string") throw new Error("Shared event metadata is damaged. Restore a backup; do not clear the sheet.");
  const chunks = sheet.getRange(1, metadata.bank, metadata.chunks, 1).getValues().map(row => {
    if (typeof row[0] !== "string" || !row[0].startsWith("data:")) throw new Error("Shared event data is damaged.");
    return row[0].slice(5);
  });
  const text = chunks.join("");
  if (digest_(text) !== metadata.hash) throw new Error("Shared event checksum failed. Restore a backup.");
  const event = globalThis.EventModel.validate(JSON.parse(text));
  return { ...metadata, event };
}

function loadEvent() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const access = access_();
    const stored = readEvent_(eventSheet_());
    return { ok: true, revision: stored.revision, event: eventCopy_(stored.event, access), access: publicAccess_(access) };
  } finally { lock.releaseLock(); }
}

function loadEventJson() {
  return JSON.stringify(loadEvent());
}

function previewMemberJson(team) {
  const loaded = loadEvent();
  if (!loaded.access.isOwner) throw new Error("App owner access required to preview the student view.");
  const teamId = String(team || "").trim().toUpperCase();
  if (!loaded.event || !loaded.event.teams.some(entry => entry.id === teamId)) throw new Error("Choose a team on the active roster to preview.");
  const access = { ...loaded.access, canEdit: true, role: "member", team: teamId, email: `student-preview@${loaded.access.domain}` };
  return JSON.stringify({ ...loaded, event: memberCopy_(loaded.event, teamId, access.email), access, previewing: true });
}

// Cheap freshness check polled by open pages. A1 holds only the revision pointer and is replaced in one write,
// so it can be read without the lock or the full event.
function eventRevisionJson() {
  const pointer = eventSheet_().getRange(1, 1).getValue();
  return JSON.stringify({ ok: true, revision: pointer === "" ? 0 : JSON.parse(pointer).revision });
}

// A refusal is final: sending the same save again would be refused again. Anything else (a lock timeout, a Google
// service hiccup, a lost connection) reaches the page as a failed call, which the page retries with the same request.
const refusal_ = error => Object.assign(error, { refused: true });

function saveJson_(requestJson, handler) {
  try {
    if (typeof requestJson !== "string") throw refusal_(new Error("Invalid shared save payload. Reload the latest app deployment."));
    let request;
    try { request = JSON.parse(requestJson); } catch (error) { throw refusal_(error); }
    return JSON.stringify(handler(request));
  } catch (error) {
    if (error.refused) return JSON.stringify({ ok: false, code: "REFUSED", message: error.message });
    throw error;
  }
}

function saveEventJson(requestJson) {
  return saveJson_(requestJson, saveEvent);
}

function saveChangesJson(requestJson) {
  return saveJson_(requestJson, saveChanges);
}

// Writes the event to the inactive bank, then commits the pointer in A1. Callers hold the script lock.
function commit_(sheet, stored, event, requestId) {
  const text = JSON.stringify(event);
  if (text.length > 10000000) throw refusal_(new Error("Shared event exceeds the 10 million character limit. Export a backup and contact the event administrator."));
  const chunks = [];
  for (let index = 0; index < text.length; index += 40000) chunks.push([`data:${text.slice(index, index + 40000)}`]);
  if (sheet.getMaxRows() < chunks.length) sheet.insertRowsAfter(sheet.getMaxRows(), chunks.length - sheet.getMaxRows());
  const bank = stored.bank === 2 ? 3 : 2;
  sheet.getRange(1, bank, chunks.length, 1).setValues(chunks);
  SpreadsheetApp.flush();
  const metadata = { revision: stored.revision + 1, previous: stored.revision, requestId, bank, chunks: chunks.length, hash: digest_(text) };
  // Commit the pointer only after the inactive data bank has been written.
  sheet.getRange(1, 1).setValue(JSON.stringify(metadata));
  SpreadsheetApp.flush();
  return { ok: true, revision: metadata.revision, previous: stored.revision };
}

// Applies one page's changes to the latest stored event. Changes to different matches, attempts, reviews, or settings
// merge; a change to something another operator changed since this page loaded is a conflict. "previous" tells the
// page whether anyone else saved in between (so it can pick up their changes).
function saveChanges(request) {
  const access = access_();
  if (!access.canEdit) throw refusal_(new Error(`Read-only access: ${access.email || "this account"} is not on the app's access list. Ask a coach to add you.`));
  if (!request || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 100 || !Array.isArray(request.changes) || request.changes.length > 20000) throw refusal_(new Error("Invalid shared save request."));
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = eventSheet_();
    const stored = readEvent_(sheet);
    if (stored.requestId === request.requestId) return { ok: true, revision: stored.revision, previous: stored.previous };
    if (!stored.event) return { ok: false, code: "CONFLICT", message: "The shared event was cleared. Reload shared data." };
    if (access.role === "member") {
      try { memberChanges_(stored.event, request.changes, access.email); } catch (error) { throw refusal_(error); }
    }
    let merged;
    try { merged = globalThis.EventChanges.apply(stored.event, request.changes); } catch (error) { throw refusal_(error); }
    if (merged.conflicts.length) return { ok: false, code: "CONFLICT", message: `Another operator changed ${merged.conflicts.slice(0, 3).join(", ")}${merged.conflicts.length > 3 ? ", and more" : ""} at the same time. Reload shared data to see their version, then redo your change if it is still needed.` };
    let event;
    try { event = globalThis.EventModel.validate(JSON.parse(JSON.stringify(merged.event))); }
    catch (error) { return { ok: false, code: "CONFLICT", message: `Your change no longer fits the latest shared event (${error.message}). Reload shared data, then redo your change if it is still needed.` }; }
    // Nothing new (for example, a retry of a save that already landed before someone else saved).
    keepsHistory_(stored.event, event);
    if (globalThis.EventChanges.stable(event) === globalThis.EventChanges.stable(stored.event)) return { ok: true, revision: stored.revision, previous: stored.revision };
    return commit_(sheet, stored, event, request.requestId);
  } finally { lock.releaseLock(); }
}

function saveEvent(request) {
  const access = access_();
  if (!access.canEdit) throw refusal_(new Error(`Read-only access: ${access.email || "this account"} is not on the app's access list. Ask a coach to add you.`));
  if (!request || !Number.isSafeInteger(request.revision) || request.revision < 0 || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 100 || !request.event || typeof request.event.sessionId !== "string" || !Array.isArray(request.event.history)) throw refusal_(new Error("Invalid shared save request."));
  let candidate;
  try { candidate = globalThis.EventModel.validate(request.event); } catch (error) { throw refusal_(error); }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = eventSheet_();
    const stored = readEvent_(sheet);
    let refused = null;
    if (access.role === "member") {
      try { candidate = memberSave_(stored.event, candidate, access.team, access.email); } catch (error) { refused = error; }
    }
    const text = JSON.stringify(candidate);
    if (text.length > 10000000) throw refusal_(new Error("Shared event exceeds the 10 million character limit. Export a backup and contact the event administrator."));
    const hash = digest_(text);
    if (!refused && stored.requestId === request.requestId && stored.hash === hash) return { ok: true, revision: stored.revision };
    if (stored.revision !== request.revision) return { ok: false, code: "CONFLICT", message: "Another operator saved a newer event. Export your pending changes, then reload shared data." };
    if (refused) throw refusal_(refused);
    keepsHistory_(stored.event, candidate);
    return commit_(sheet, stored, candidate, request.requestId);
  } finally { lock.releaseLock(); }
}

function requireCoach_() {
  const access = access_();
  if (access.role !== "coach") throw new Error("Only coaches can manage app access.");
  return access;
}

function loadAccessJson() {
  const access = requireCoach_();
  return JSON.stringify({ ok: true, owner: access.owner, domain: access.domain, entries: accessList_(access.domain) });
}

// Replaces the whole access list. The owner is always a coach and is not stored in the list.
function saveAccessJson(requestJson) {
  const access = requireCoach_();
  const request = JSON.parse(String(requestJson || "null"));
  if (!request || !Array.isArray(request.entries) || request.entries.length > 500) throw new Error("Invalid access list.");
  const seen = new Set();
  const entries = request.entries.map((entry, index) => {
    const normalized = normalizeAccess_(entry, access.domain);
    if (!normalized) throw new Error(`Access row ${index + 1}: enter an @${access.domain} email, a role of coach or member, and a team number for members.`);
    if (normalized.email === access.owner) throw new Error(`${normalized.email} owns the app and is always a coach; remove that row.`);
    if (seen.has(normalized.email)) throw new Error(`${normalized.email} is listed more than once.`);
    seen.add(normalized.email);
    return normalized;
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const book = spreadsheet_();
    const sheet = book.getSheetByName(ACCESS_SHEET) || book.insertSheet(ACCESS_SHEET);
    const now = new Date().toISOString();
    const rows = [ACCESS_HEADERS, ...entries.map(entry => [entry.email, entry.role, entry.team, access.email, now, entry.name])];
    if (sheet.getLastRow() > 0) sheet.getRange(1, 1, sheet.getLastRow(), ACCESS_HEADERS.length).clearContent();
    sheet.getRange(1, 1, rows.length, ACCESS_HEADERS.length).setValues(rows);
    SpreadsheetApp.flush();
    return JSON.stringify({ ok: true, owner: access.owner, domain: access.domain, entries });
  } finally { lock.releaseLock(); }
}
