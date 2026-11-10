"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const EventModel = require("./event.js");

function fixture() {
  return EventModel.validate({ version: 1, sessionId: crypto.randomUUID(), history: [], name: "Shared test", teams: [], matches: [], skills: [], skillsOnly: false, rounds: 6, start: "09:00", interval: 3, selected: null });
}

function server() {
  let canRead = true;
  let canWrite = true;
  let failCommit = false;
  let locked = false;
  let email = "coach@nu-district.org";
  const owner = "coach@nu-district.org";
  const createSheet = commitColumn => {
    const cells = new Map();
    const write = (column, commit) => {
      if (!canWrite) throw new Error("Permission denied");
      if (commit && failCommit && column === commitColumn) throw new Error("Commit failed");
    };
    return {
      cells,
      getMaxRows: () => 1000,
      getLastRow: () => Math.max(0, ...[...cells].filter(([, value]) => value !== "").map(([key]) => Number(key.split(":")[0]))),
      getRange(row, column, rows = 1, columns = 1) {
        const read = (r, c) => cells.get(`${row + r}:${column + c}`) ?? "";
        return {
          getValue: () => read(0, 0),
          getValues: () => Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => read(r, c))),
          setValues(values) {
            write(column, false);
            values.forEach((line, r) => line.forEach((value, c) => cells.set(`${row + r}:${column + c}`, value)));
          },
          setValue(value) {
            write(column, true);
            cells.set(`${row}:${column}`, value);
          },
          clearContent() {
            write(column, false);
            for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) cells.delete(`${row + r}:${column + c}`);
          }
        };
      }
    };
  };
  const sheets = new Map([["EventStore", createSheet(1)]]);
  const book = {
    getSheetByName: name => sheets.get(name) || null,
    insertSheet(name) { if (!canWrite) throw new Error("Permission denied"); sheets.set(name, createSheet(null)); return sheets.get(name); }
  };
  const context = vm.createContext({
    EventModel,
    ScoreHistory: require("./history.js"),
    EventChanges: require("./changes.js"),
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === "SPREADSHEET_ID" ? "test-sheet" : null }) },
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => owner }) },
    SpreadsheetApp: { openById() { if (!canRead) throw new Error("No access"); return book; }, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; }, releaseLock() { locked = false; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" }, computeDigest: (algorithm, text) => [...crypto.createHash(algorithm).update(text).digest()] }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "apps-script", "Code.gs"), "utf8"), context);
  const grant = entries => { const previous = email; email = owner; context.saveAccessJson(JSON.stringify({ entries })); email = previous; };
  return { context, cells: sheets.get("EventStore").cells, sheets, permissions(read, write) { canRead = read; canWrite = write; }, failCommit(value) { failCommit = value; }, signIn(value) { email = value; }, grant, isLocked: () => locked };
}

test("shared saves enforce revisions, deduplicate identical retries, and release locks", () => {
  const { context: api, isLocked } = server();
  assert.equal(api.loadEvent().revision, 0);
  const request = { revision: 0, requestId: "first", event: fixture() };
  assert.equal(api.saveEvent(request).revision, 1);
  assert.equal(api.saveEvent(request).revision, 1);
  const conflicting = api.saveEvent({ ...request, requestId: "second" });
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.code, "CONFLICT");
  assert.equal(api.loadEvent().event.sessionId, request.event.sessionId);
  assert.equal(isLocked(), false);
});

test("caller spreadsheet permissions govern reads and writes", () => {
  const { context: api, permissions, isLocked } = server();
  permissions(false, false);
  assert.throws(() => api.loadEvent(), /No access/);
  permissions(true, false);
  assert.equal(api.loadEvent().event, null);
  assert.throws(() => api.saveEvent({ revision: 0, requestId: "viewer", event: fixture() }), /Permission denied/);
  assert.equal(isLocked(), false);
});

function coachingFixture() {
  const History = require("./history.js");
  const Rubric = require("./rubric.js");
  const event = fixture();
  event.teams = [{ id: "1A", name: "One", draw: 0 }];
  const blankRubric = criteria => ({ team: { id: "1A", name: "One" }, version: "v2.0", evaluatedOn: "2026-10-01", updatedAt: "2026-10-01T12:00:00.000Z", reviewer: "Coach Kim", overallNotes: "Private feedback", scores: Object.fromEntries(criteria.map(({ id }) => [id, null])), notes: Object.fromEntries(criteria.map(({ id }) => [id, "Private criterion note"])) });
  event.rubrics = [blankRubric(Rubric.criteria)];
  event.interviews = [blankRubric(Rubric.Interview.criteria)];
  event.robots = [{ id: "robot-1", team: "1A", name: "Clawbot", startedAt: "2026-10-02T12:00:00.000Z", notes: "Private design note" }];
  const Core = require("./core.js");
  event.history = [History.practiceRecord([], event.teams, { mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([1, 0, 0, 0, 0]), occurredAt: "2026-10-03T12:00:00.000Z", notes: "Private run note", status: "ok", optIn: false, stopTime: 0 })];
  return EventModel.validate(event);
}

test("coach student preview returns member-redacted live data without changing the event", () => {
  const { context: api, grant, signIn } = server();
  const event = coachingFixture();
  const History = require("./history.js");
  const secondTeam = { id: "2A", name: "Two", draw: 1 };
  event.teams.push(secondTeam);
  event.rubrics.push({ ...event.rubrics[0], id: History.newId(), team: secondTeam });
  event.interviews.push({ ...event.interviews[0], id: History.newId(), team: secondTeam });
  api.saveEvent({ revision: 0, requestId: "setup-preview", event });
  const revision = api.loadEvent().revision;

  const preview = JSON.parse(api.previewMemberJson("1A"));
  assert.equal(preview.access.role, "member");
  assert.equal(preview.access.team, "1A");
  assert.equal(preview.previewing, true);
  assert.equal(preview.event.rubrics[0].overallNotes, "Private feedback");
  assert.equal(preview.event.rubrics[1].overallNotes, "");
  assert.equal(preview.event.interviews[0].overallNotes, "Private feedback");
  assert.equal(preview.event.interviews[1].overallNotes, "");
  assert.equal(api.loadEvent().revision, revision, "preview does not save to the shared event");
  assert.throws(() => api.previewMemberJson("3A"), /Choose a team on the active roster/);

  grant([{ email: "listed-coach@nu-district.org", role: "coach" }]);
  signIn("listed-coach@nu-district.org");
  assert.equal(api.loadEvent().access.isOwner, false);
  assert.throws(() => api.previewMemberJson("1A"), /App owner access required/);

  grant([{ email: "student@nu-district.org", role: "member", team: "1A" }]);
  signIn("student@nu-district.org");
  assert.throws(() => api.previewMemberJson("1A"), /App owner access required/);
});

test("members manage only their own student reviews on both shared save protocols, with private feedback preserved", () => {
  const Rubric = require("./rubric.js");
  const Changes = require("./changes.js");
  for (const protocol of ["event", "changes"]) for (const [key, rubric] of [["rubrics", Rubric], ["interviews", Rubric.Interview]]) {
    const { context: api, signIn, grant } = server();
    const email = "student@nu-district.org";
    grant([{ email, role: "member", team: "2A" }, { email: "other@nu-district.org", role: "member", team: "2A" }, { email: "recipient@nu-district.org", role: "member", team: "1A" }]);
    const setup = coachingFixture();
    setup.teams.push({ id: "2A", name: "Two", draw: 1 });
    api.saveEvent({ revision: 0, requestId: "setup", event: setup });
    signIn(email);
    let serial = 0;
    const request = mutate => {
      const loaded = api.loadEvent();
      const candidate = JSON.parse(JSON.stringify(loaded.event));
      mutate(candidate);
      return protocol === "event"
        ? { revision: loaded.revision, requestId: `review-${++serial}`, event: candidate }
        : { requestId: `review-${++serial}`, changes: Changes.diff(loaded.event, candidate) };
    };
    const save = request => protocol === "event" ? api.saveEvent(request) : api.saveChanges(request);
    const input = {
      evaluatedOn: "2026-11-02", reviewer: "Student", overallNotes: "My peer feedback",
      reviewRole: "member", authorEmail: email,
      scores: Object.fromEntries(rubric.criteria.map(({ id }) => [id, rubric.maximum])),
      notes: Object.fromEntries(rubric.criteria.map(({ id }) => [id, "Peer note"]))
    };
    const add = request(next => { next[key] = rubric.save(next[key], next.teams[0], input); });
    assert.equal(save(add).ok, true);
    assert.equal(save(add).ok, true, "retry does not duplicate a review");
    const own = api.loadEvent().event[key].find(entry => entry.reviewRole === "member");
    assert.equal(own.overallNotes, input.overallNotes, "author sees feedback for a different team");
    assert.equal(api.loadEvent().event[key].find(entry => entry.reviewRole !== "member").overallNotes, "");
    signIn("recipient@nu-district.org");
    assert.equal(api.loadEvent().event[key].find(entry => entry.id === own.id).overallNotes, input.overallNotes);
    assert.throws(() => save(request(next => { next[key] = rubric.remove(next[key], own.id); })), /own student/);
    signIn("viewer@gmail.com");
    const viewerReview = api.loadEvent().event[key].find(entry => entry.id === own.id);
    assert.equal(viewerReview.overallNotes, "");
    assert.equal(viewerReview.authorEmail, "");
    signIn(email);
    for (const mutate of [
      next => { next[key].find(entry => entry.id === own.id).reviewRole = "coach"; },
      next => { next[key].find(entry => entry.id === own.id).authorEmail = "other@nu-district.org"; },
      next => { next[key].find(entry => entry.id === own.id).team = { id: "2A", name: "Two" }; },
      next => { next[key][0].overallNotes = "Rewrite coach review"; },
      next => { next[key] = next[key].filter(entry => entry.reviewRole === "member"); },
      next => { next[key] = rubric.save(next[key], next.teams[0], { ...input, reviewRole: "coach" }); }
    ]) assert.throws(() => save(request(mutate)), /own student|coach access/i);
    signIn("other@nu-district.org");
    const hidden = api.loadEvent().event[key].find(entry => entry.id === own.id);
    assert.equal(hidden.overallNotes, "");
    assert.equal(hidden.authorEmail, "");
    assert.throws(() => save(request(next => { next[key] = next[key].filter(entry => entry.id !== own.id); })), /own student/);
    signIn(email);
    assert.equal(save(request(next => { next[key] = rubric.save(next[key], next.teams[0], { ...input, overallNotes: "Revised feedback" }, own.id); })).ok, true);
    signIn("coach@nu-district.org");
    const stored = api.loadEvent().event;
    assert.equal(stored[key][0].overallNotes, "Private feedback");
    assert.equal(stored[key].find(entry => entry.id === own.id).overallNotes, "Revised feedback");
    assert.equal(save(request(next => {
      next[key] = rubric.save(next[key], next.teams[0], { ...input, reviewRole: "coach", overallNotes: "Coach correction" }, own.id);
    })).ok, true);
    assert.equal(api.loadEvent().event[key].find(entry => entry.id === own.id).reviewRole, "member");
    signIn(email);
    assert.equal(save(request(next => { next[key] = rubric.remove(next[key], own.id); })).ok, true);
    assert.equal(api.loadEvent().event[key].length, 1);
    signIn("coach@nu-district.org");
    assert.equal(api.loadEvent().event[key][0].overallNotes, "Private feedback");
  }
});

test("only coaches and listed members can save; everyone else gets a read-only copy without coaching notes", () => {
  const { context: api, signIn, grant, isLocked } = server();
  const event = coachingFixture();
  assert.equal(api.saveEvent({ revision: 0, requestId: "coach", event }).revision, 1);
  const editor = api.loadEvent();
  assert.deepEqual({ ...editor.access }, { canEdit: true, role: "coach", team: "", email: "coach@nu-district.org", domain: "nu-district.org", isOwner: true });
  assert.equal(editor.event.rubrics[0].overallNotes, "Private feedback");

  for (const visitor of ["parent@gmail.com", "", "someone@not-nu-district.org", "nu-district.org@evil.com", "unlisted@nu-district.org"]) {
    signIn(visitor);
    const viewer = api.loadEvent();
    assert.equal(viewer.access.canEdit, false, visitor);
    const text = JSON.stringify(viewer.event);
    assert.doesNotMatch(text, /Private|Coach Kim/, visitor);
    assert.doesNotThrow(() => EventModel.validate(JSON.parse(text)), visitor);
    assert.equal(viewer.event.history.length, 1);
    assert.equal(viewer.event.rubrics[0].scores[Object.keys(viewer.event.rubrics[0].scores)[0]], null);
    assert.equal(viewer.event.robots[0].name, "Clawbot");
    assert.equal(viewer.access.role, "viewer");
    assert.throws(() => api.saveEvent({ revision: 1, requestId: `viewer-${visitor}`, event }), /Read-only access: .*not on the app's access list/);
    assert.equal(isLocked(), false);
  }
  grant([{ email: "Teacher@NU-District.org", role: "coach", team: "" }]);
  signIn("Teacher@NU-District.org");
  assert.equal(api.loadEvent().access.role, "coach");
  assert.equal(api.loadEvent().event.robots[0].notes, "Private design note");
});

function memberFixture() {
  const Rubric = require("./rubric.js");
  const event = coachingFixture();
  event.teams.push({ id: "2A", name: "Two", draw: 1 });
  const other = criteria => ({ team: { id: "2A", name: "Two" }, version: "v2.0", evaluatedOn: "2026-10-01", updatedAt: "2026-10-01T12:00:00.000Z", reviewer: "Coach Lee", overallNotes: "Other team secret", scores: Object.fromEntries(criteria.map(({ id }) => [id, 2])), notes: Object.fromEntries(criteria.map(({ id }) => [id, "Other team note"])) });
  event.rubrics.push(other(Rubric.criteria));
  event.interviews.push(other(Rubric.Interview.criteria));
  event.matches = [{ id: 1, round: 1, teams: ["1A", "2A"], surrogate: null, result: null }];
  return EventModel.validate(event);
}

test("coaches manage the access list on the Access sheet; invalid or unauthorized changes are refused", () => {
  const { context: api, signIn, sheets, isLocked } = server();
  assert.deepEqual(JSON.parse(api.loadAccessJson()), { ok: true, owner: "coach@nu-district.org", domain: "nu-district.org", entries: [] });
  const saved = JSON.parse(api.saveAccessJson(JSON.stringify({ entries: [{ name: "Kim Coach", email: " Kim@NU-District.org ", role: "Coach", team: "9Z" }, { name: "Sam Student", email: "student@nu-district.org", role: "member", team: "1a" }] })));
  assert.deepEqual(saved.entries, [{ name: "Kim Coach", email: "kim@nu-district.org", role: "coach", team: "" }, { name: "Sam Student", email: "student@nu-district.org", role: "member", team: "1A" }]);
  const sheet = sheets.get("Access");
  assert.deepEqual(sheet.getRange(1, 1, 1, 3).getValues()[0], ["Email", "Role", "Team"]);
  assert.equal(sheet.getRange(3, 4).getValue(), "coach@nu-district.org");
  assert.equal(sheet.getRange(2, 6).getValue(), "Kim Coach");
  for (const [entries, pattern] of [
    [[{ email: "parent@gmail.com", role: "member", team: "1A" }], /@nu-district\.org email/],
    [[{ email: "a@nu-district.org", role: "member", team: "" }], /team number/],
    [[{ email: "a@nu-district.org", role: "admin", team: "" }], /role/],
    [[{ email: "a@nu-district.org", role: "coach" }, { email: "A@nu-district.org", role: "member", team: "1A" }], /more than once/],
    [[{ email: "coach@nu-district.org", role: "member", team: "1A" }], /owns the app/],
    [[{ name: "N".repeat(81), email: "a@nu-district.org", role: "coach" }], /@nu-district\.org email/]
  ]) assert.throws(() => api.saveAccessJson(JSON.stringify({ entries })), pattern);
  assert.equal(JSON.parse(api.loadAccessJson()).entries.length, 2);
  // Rows typed by hand in the sheet are read case-insensitively; invalid rows are ignored rather than blocking access.
  sheet.getRange(4, 1, 1, 3).setValues([["junk", "coach", ""]]);
  sheet.getRange(5, 1, 1, 3).setValues([["Helper@nu-district.org", "MEMBER", "2a"]]);
  signIn("helper@nu-district.org");
  assert.deepEqual({ ...api.loadEvent().access }, { canEdit: true, role: "member", team: "2A", email: "helper@nu-district.org", domain: "nu-district.org", isOwner: false });
  assert.throws(() => api.loadAccessJson(), /Only coaches/);
  assert.throws(() => api.saveAccessJson(JSON.stringify({ entries: [] })), /Only coaches/);
  signIn("kim@nu-district.org");
  assert.equal(JSON.parse(api.loadAccessJson()).entries.find(entry => entry.email === "helper@nu-district.org").name, "");
  assert.equal(JSON.parse(api.saveAccessJson(JSON.stringify({ entries: [] }))).entries.length, 0);
  assert.equal(sheet.getLastRow(), 1);
  signIn("helper@nu-district.org");
  assert.equal(api.loadEvent().access.role, "viewer");
  signIn("kim@nu-district.org");
  assert.equal(api.loadEvent().access.role, "viewer");
  assert.equal(isLocked(), false);
});

test("team members read only their own team's feedback and can save new practice runs but not score matches or skills, change setup, or reviews", () => {
  const History = require("./history.js");
  const Core = require("./core.js");
  const { context: api, signIn, grant, isLocked } = server();
  grant([{ email: "student@nu-district.org", role: "member", team: "1A" }]);
  signIn("student@nu-district.org");
  assert.throws(() => api.saveEvent({ revision: 0, requestId: "early", event: fixture() }), /coach must set up/);
  signIn("coach@nu-district.org");
  api.saveEvent({ revision: 0, requestId: "setup", event: memberFixture() });
  signIn("student@nu-district.org");
  const loaded = api.loadEvent();
  assert.equal(loaded.access.role, "member");
  assert.equal(loaded.access.team, "1A");
  assert.equal(loaded.event.rubrics.find(entry => entry.team.id === "1A").overallNotes, "Private feedback");
  assert.equal(loaded.event.rubrics.find(entry => entry.team.id === "2A").overallNotes, "");
  assert.equal(loaded.event.interviews.find(entry => entry.team.id === "2A").reviewer, "");
  assert.ok(!JSON.stringify(loaded.event).includes("Other team"));
  assert.ok(loaded.event.rubrics.find(entry => entry.team.id === "2A").scores, "other teams keep their scores");
  assert.equal(loaded.event.robots[0].notes, "Private design note");

  // Members cannot post match or skills results; only a new practice run is accepted.
  const postMatch = next => {
    next.matches[0].result = { counts: [2, 0, 0, 0, 0], goals: Core.goalsFromCounts([2, 0, 0, 0, 0]), statuses: { "1A": "ok", "2A": "ok" } };
    next.history.push(History.capture(next, "teamwork", next.matches[0], "posted"));
  };
  const postSkill = (next, attempt, counts) => {
    const skill = { team: "2A", mode: "driver", attempt, status: "ok", counts, optIn: false, stopTime: 0 };
    next.skills.push(skill);
    next.history.push(History.capture(next, "skills", skill, "posted"));
  };
  for (const [name, mutate] of [["post match", postMatch], ["post skills", next => postSkill(next, 1, [1, 0, 0, 0, 0])]]) {
    const next = JSON.parse(JSON.stringify(loaded.event));
    mutate(next);
    assert.throws(() => api.saveEvent({ revision: 1, requestId: `member-${name}`, event: next }), /Coach access required to score matches or skills/, name);
  }
  const event = JSON.parse(JSON.stringify(loaded.event));
  event.history.push(History.practiceRecord(event.history, event.teams, { runRole: "member", mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([3, 0, 0, 0, 0]), occurredAt: "2026-10-04T12:00:00.000Z", notes: "Member run", status: "ok", optIn: false, stopTime: 0 }));
  event.selected = 1;
  const request = { revision: 1, requestId: "member-post", event };
  assert.equal(api.saveEvent(request).revision, 2);
  assert.equal(api.saveEvent(request).revision, 2);

  // A coach posts the match and skills results.
  signIn("coach@nu-district.org");
  const scored = api.loadEvent().event;
  postMatch(scored);
  postSkill(scored, 1, [1, 0, 0, 0, 0]);
  assert.equal(api.saveEvent({ revision: 2, requestId: "coach-post", event: scored }).revision, 3);
  const stored = api.loadEvent().event;
  assert.equal(stored.rubrics.find(entry => entry.team.id === "2A").overallNotes, "Other team secret");
  assert.equal(stored.interviews.find(entry => entry.team.id === "2A").notes[Object.keys(stored.interviews[1].notes)[0]], "Other team note");
  assert.equal(stored.matches[0].result.counts[0], 2);
  assert.equal(stored.history.length, 4);

  signIn("student@nu-district.org");
  const base = api.loadEvent().event;
  const Rubric = require("./rubric.js");
  for (const [mutate, pattern] of [
    [next => { next.teams[0].name = "Renamed"; }, /team roster/],
    [next => { next.name = "Other"; }, /event name/],
    [next => { next.rounds = 7; }, /schedule/],
    [next => { next.matches[0].teams = ["2A", "1A"]; }, /schedule or finals/],
    [next => { next.robots = []; }, /robot versions/],
    [next => { next.rubrics = Rubric.save(next.rubrics, next.teams[0], { ...next.rubrics[0], overallNotes: "Self review" }); }, /notebook reviews/],
    [next => { next.interviews[1].overallNotes = "Guess"; }, /interview reviews/],
    [next => { next.skillsOnly = true; }, /event type/]
  ]) {
    const next = JSON.parse(JSON.stringify(base));
    mutate(next);
    assert.throws(() => api.saveEvent({ revision: 3, requestId: `member-${pattern}`, event: next }), pattern);
    assert.equal(isLocked(), false);
  }
  assert.equal(api.saveEvent({ revision: 2, requestId: "stale", event: base }).code, "CONFLICT");

  // Members cannot touch results: no new match or skills posts, updates, removals, voids, or practice edits.
  const runId = base.history.find(record => record.source === "practice").runId;
  const counts = [4, 0, 0, 0, 0];
  for (const [name, mutate] of [
    ["update match", next => { next.matches[0].result = { ...next.matches[0].result, counts, goals: Core.goalsFromCounts(counts) }; next.history.push(History.capture(next, "teamwork", next.matches[0], "updated")); }],
    ["update match posing as a first post", next => { next.matches[0].result = { ...next.matches[0].result, counts, goals: Core.goalsFromCounts(counts) }; next.history.push(History.capture(next, "teamwork", next.matches[0], "posted")); }],
    ["repost unchanged match", next => { next.history.push(History.capture(next, "teamwork", next.matches[0], "posted")); }],
    ["remove match", next => { next.history.push(History.capture(next, "teamwork", next.matches[0], "removed")); next.matches[0].result = null; }],
    ["void skills", next => { next.history.push(History.capture(next, "skills", next.skills[0], "voided")); next.skills = []; }],
    ["update skills", next => { next.skills[0] = { ...next.skills[0], counts, goals: Core.goalsFromCounts(counts) }; next.history.push(History.capture(next, "skills", next.skills[0], "updated")); }],
    ["edit practice", next => { next.history.push(History.practiceRecord(next.history, next.teams, { mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts(counts), occurredAt: "2026-10-04T12:00:00.000Z", notes: "Edited", status: "ok", optIn: false, stopTime: 0 }, runId)); }],
    ["remove practice", next => { next.history.push(History.removePractice(next.history, runId)); }],
    ["post another skills attempt", next => postSkill(next, 2, counts)]
  ]) {
    const next = JSON.parse(JSON.stringify(base));
    mutate(next);
    assert.throws(() => api.saveEvent({ revision: 3, requestId: `member-${name}`, event: next }), /Coach access required to score matches or skills/, name);
  }

  // Another practice run is still welcome.
  const next = JSON.parse(JSON.stringify(base));
  next.history.push(History.practiceRecord(next.history, next.teams, { runRole: "member", mode: "driver", teams: ["2A"], goals: Core.goalsFromCounts(counts), occurredAt: "2026-10-05T12:00:00.000Z", notes: "", status: "ok", optIn: false, stopTime: 0 }));
  assert.equal(api.saveEvent({ revision: 3, requestId: "member-more", event: next }).revision, 4);

  // Coaches can still correct anything.
  signIn("coach@nu-district.org");
  const coach = api.loadEvent().event;
  coach.history.push(History.capture(coach, "teamwork", coach.matches[0], "removed"));
  coach.matches[0].result = null;
  assert.equal(api.saveEvent({ revision: 4, requestId: "coach-fix", event: coach }).revision, 5);
});

test("failed pointer commit leaves the previous complete bank readable", () => {
  const { context: api, failCommit } = server();
  const event = fixture();
  api.saveEvent({ revision: 0, requestId: "first", event });
  const next = structuredClone(event);
  next.name = "Uncommitted";
  failCommit(true);
  assert.throws(() => api.saveEvent({ revision: 1, requestId: "second", event: next }), /Commit failed/);
  assert.equal(api.loadEvent().event.name, "Shared test");
  assert.equal(api.loadEvent().revision, 1);
  failCommit(false);
  assert.equal(api.saveEvent({ revision: 1, requestId: "retry", event: next }).revision, 2);
});

test("server refuses invalid events, damaged storage, and rewrites of existing history", () => {
  const { context: api, cells } = server();
  const event = fixture();
  event.teams = [{ id: "1A", name: "One", draw: 0 }];
  const entry = { team: "1A", mode: "driver", attempt: 1, status: "ok", counts: [1, 0, 0, 0, 0], optIn: false, stopTime: 0 };
  const History = require("./history.js");
  event.skills = [entry];
  event.history = [History.capture(event, "skills", entry, "posted")];
  api.saveEvent({ revision: 0, requestId: "first", event });
  assert.throws(() => api.saveEvent({ revision: 1, requestId: "invalid", event: { ...event, rounds: 0 } }), /schedule/);
  assert.throws(() => api.saveEvent({ revision: 1, requestId: "deleted", event: { ...event, history: [] } }), /cannot be deleted/);
  const pointer = JSON.parse(cells.get("1:1"));
  cells.set(`1:${pointer.bank}`, "data:damaged");
  assert.throws(() => api.loadEvent(), /checksum/);
});

test("large events are chunked and reconstructed without spreadsheet formula interpretation", () => {
  const { context: api, cells } = server();
  const event = fixture();
  event.teams = [{ id: "1A", name: "One", draw: 0 }];
  const History = require("./history.js");
  for (let index = 0; index < 150; index++) event.history.push(History.capture(event, "skills", { team: "1A", mode: "driver", attempt: 1, status: "ok", counts: [1, 0, 0, 0, 0], optIn: false, stopTime: 0 }, "updated"));
  api.saveEvent({ revision: 0, requestId: "large", event });
  const metadata = JSON.parse(cells.get("1:1"));
  assert.ok(metadata.chunks > 1);
  assert.equal(api.loadEvent().event.history.length, 150);
  for (let index = 1; index <= metadata.chunks; index++) assert.ok(cells.get(`${index}:${metadata.bank}`).startsWith("data:"));
});

function client(api) {
  const runner = {
    withSuccessHandler(success) {
      return {
        withFailureHandler(failure) {
          return new Proxy({}, { get: (_, method) => argument => {
            try { success(api[method](argument)); } catch (error) { failure(error); }
          } });
        }
      };
    }
  };
  const context = vm.createContext({ google: { script: { run: runner } }, ScoreHistory: { newId: () => crypto.randomUUID() }, EventChanges: require("./changes.js"), structuredClone, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "storage.js"), "utf8"), context);
  return context.EventStorage;
}

test("shared clients queue immutable saves and freeze stale writes until reloaded", async () => {
  const { context: api } = server();
  const first = client(api);
  const second = client(api);
  assert.equal(await first.load(), undefined);
  await second.load();
  const event = fixture();
  const saving = first.save(event);
  event.name = "Later mutation";
  await saving;
  assert.equal(api.loadEvent().event.name, "Shared test");
  await assert.rejects(second.save(event), /Another operator/);
  assert.equal(second.conflicted, true);
  await assert.rejects(second.save(event), /Reload shared/);
  await second.load();
  assert.equal(second.conflicted, false);
  await second.save(event);
  assert.equal(api.loadEvent().event.name, "Later mutation");
});

test("shared clients report read-only access and refuse viewer saves before calling the server", async () => {
  const { context: api, signIn } = server();
  api.saveEvent({ revision: 0, requestId: "coach", event: fixture() });
  signIn("parent@gmail.com");
  const viewer = client(api);
  await viewer.load();
  assert.equal(viewer.readOnly, true);
  assert.equal(viewer.access.domain, "nu-district.org");
  assert.equal(viewer.access.role, "viewer");
  await assert.rejects(viewer.save(fixture()), /Read-only access: ask a coach/);
  signIn("coach@nu-district.org");
  const editor = client(api);
  await editor.load();
  assert.equal(editor.readOnly, false);
  await editor.save(fixture());
  assert.equal(api.loadEvent().revision, 2);
});

test("shared clients report team member access and the coach-only access list API", async () => {
  const { context: api, signIn, grant } = server();
  api.saveEvent({ revision: 0, requestId: "coach", event: memberFixture() });
  const coach = client(api);
  await coach.load();
  assert.equal(coach.access.role, "coach");
  assert.equal((await coach.saveAccess([{ name: "Taylor Student", email: "student@nu-district.org", role: "member", team: "2A" }])).entries.length, 1);
  assert.equal((await coach.loadAccess()).entries[0].team, "2A");
  signIn("student@nu-district.org");
  const member = client(api);
  const event = await member.load();
  assert.equal(member.readOnly, false);
  assert.deepEqual({ ...member.access }, { canEdit: true, role: "member", team: "2A", email: "student@nu-district.org", domain: "nu-district.org", isOwner: false });
  await member.save({ ...event, selected: 1 });
  await assert.rejects(member.loadAccess(), /Only coaches/);
  grant([]);
  await assert.rejects(member.save({ ...event, selected: null }), /not on the app's access list/);
});

test("shared model sources run in the Apps Script environment without Node globals", () => {
  const context = vm.createContext({});
  for (const name of ["games/level-up/definition.js", "game.js", "core.js", "finals.js", "history.js", "rubric.js", "event.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, name), "utf8"), context);
  const event = context.EventModel.validate(JSON.parse(JSON.stringify(fixture())));
  assert.equal(event.name, "Shared test");
  assert.equal(context.ScoreHistory.analyze(event.history).resolved.length, 0);
});

test("shared models validate legacy events with finals when Array.at and Web Crypto are unavailable", () => {
  const Core = require("./core.js");
  const Finals = require("./finals.js");
  const event = fixture();
  event.teams = Array.from({ length: 4 }, (_, index) => ({ id: `${index + 1}A`, name: `Finalist ${index + 1}`, draw: index }));
  event.matches = Core.schedule(event.teams, 1, () => 0.5);
  event.matches.forEach(match => { match.result = { counts: [10, 0, 0, 0, 0], statuses: Object.fromEntries(match.teams.map(id => [id, "ok"])) }; });
  event.finals = Finals.generate(event.teams, event.matches, 4);
  event.finals[0].result = { counts: [20, 0, 0, 0, 0], statuses: Object.fromEntries(event.finals[0].teams.map(id => [id, "ok"])), stopTime: 0 };
  delete event.sessionId;
  delete event.history;
  const context = vm.createContext({ Utilities: { getUuid: () => crypto.randomUUID() } });
  vm.runInContext("delete Array.prototype.at;", context);
  for (const name of ["games/level-up/definition.js", "game.js", "core.js", "finals.js", "history.js", "rubric.js", "event.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, name), "utf8"), context);
  assert.equal(typeof context.crypto, "undefined");
  const loaded = context.EventModel.validate(JSON.parse(JSON.stringify(event)));
  assert.match(loaded.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(loaded.history.length, event.matches.length + 1);
  assert.equal(new Set(loaded.history.map(record => record.id)).size, loaded.history.length);
  assert.equal(context.MatchCore.schedule(event.teams, 2, () => 0.5).length, 4);
});

test("score IDs fall back to random UUIDs when no secure-context crypto is available", () => {
  const context = vm.createContext({});
  for (const name of ["games/level-up/definition.js", "game.js", "core.js", "finals.js", "history.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, name), "utf8"), context);
  const ids = Array.from({ length: 50 }, () => context.ScoreHistory.newId());
  assert.ok(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test("shared finals preserve seeds, selected phase, results, and immutable history separately from qualifications", () => {
  const { context: api } = server();
  const Core = require("./core.js");
  const Finals = require("./finals.js");
  const History = require("./history.js");
  const event = fixture();
  event.teams = Array.from({ length: 4 }, (_, index) => ({ id: `${index + 1}A`, name: `Finalist ${index + 1}`, draw: index }));
  event.matches = Core.schedule(event.teams, 1, () => 0.5);
  event.matches.forEach(match => {
    match.result = { counts: [10, 0, 0, 0, 0], statuses: Object.fromEntries(match.teams.map(id => [id, "ok"])) };
    event.history.push(History.capture(event, "teamwork", match, "posted"));
  });
  event.finals = Finals.generate(event.teams, event.matches, 4);
  event.selectedPhase = "finals"; event.selected = 1;
  const final = event.finals[0];
  final.result = { counts: [20, 0, 0, 0, 0], statuses: Object.fromEntries(final.teams.map(id => [id, "ok"])), stopTime: 0 };
  event.history.push(History.capture(event, "teamwork", final, "posted"));
  assert.equal(api.saveEvent({ revision: 0, requestId: "finals", event }).revision, 1);
  const loaded = JSON.parse(api.loadEventJson()).event;
  assert.deepEqual(loaded, event);
  assert.equal(History.resolve(loaded.history).length, event.matches.length + 1);
  assert.equal(loaded.selectedPhase, "finals");
  assert.throws(() => api.saveEvent({ revision: 1, requestId: "erase-final", event: { ...loaded, history: loaded.history.slice(0, -1) } }), /cannot be deleted/);
});

test("web entry point loads without the unsupported external favicon", () => {
  const output = { setTitle(title) { assert.equal(title, "Level Up | Shared Match Manager"); return this; } };
  const context = vm.createContext({
    HtmlService: { createHtmlOutputFromFile(name) { assert.equal(name, "Index"); return output; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }
  });
  context.globalThis = context;
  for (const name of ["games/level-up/definition.js", "game.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, name), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "apps-script", "Code.gs"), "utf8"), context);
  assert.equal(context.doGet(), output);
});

test("favicon configuration failure is logged without preventing page loading", () => {
  for (const fails of [false, true]) {
    const warnings = [];
    const output = {
      setTitle() { return this; },
      setFaviconUrl(url) {
        assert.equal(url, "https://example.com/logo.png");
        if (fails) throw new Error("Image type is not supported");
        return this;
      }
    };
    const context = vm.createContext({
      HtmlService: { createHtmlOutputFromFile: () => output },
      PropertiesService: { getScriptProperties: () => ({ getProperty(key) { assert.equal(key, "FAVICON_URL"); return "https://example.com/logo.png"; } }) },
      console: { warn: message => warnings.push(message) }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "apps-script", "Code.gs"), "utf8"), context);
    assert.equal(context.doGet(), output);
    assert.equal(warnings.length, fails ? 1 : 0);
    if (fails) assert.match(warnings[0], /default icon.*Image type is not supported/);
  }
});

test("reported revision-three event validates and survives the JSON RPC round trip", async () => {
  const event = JSON.parse('{"version":1,"name":"Local teamwork","skillsOnly":false,"rounds":6,"skills":[],"sessionId":"5e280236-31bd-46e6-9faf-388674bfb8f2","selected":1,"start":"09:00","history":[],"teams":[{"id":"28101A","name":"Robots","draw":603471216},{"id":"28101B","draw":1346451915,"name":"Banana Bots"}],"interval":3,"matches":[{"id":1,"result":null,"teams":["28101A","28101B"],"surrogate":null,"round":1},{"round":2,"surrogate":null,"teams":["28101A","28101B"],"result":null,"id":2},{"teams":["28101B","28101A"],"surrogate":null,"result":null,"id":3,"round":3},{"teams":["28101B","28101A"],"id":4,"result":null,"round":4,"surrogate":null},{"surrogate":null,"round":5,"result":null,"id":5,"teams":["28101A","28101B"]},{"teams":["28101B","28101A"],"surrogate":null,"round":6,"result":null,"id":6}]}');
  assert.equal(EventModel.validate(event), event);
  const { context: api } = server();
  const storage = client(api);
  await storage.load();
  await storage.save(event);
  const restored = await storage.load();
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), event);
  assert.equal(EventModel.validate(restored).matches.length, 6);
  assert.equal(restored.matches[0].surrogate, null);
  assert.equal(restored.matches[0].result, null);
});

test("shared saves retry lost connections without saving twice, but never retry a refusal", async () => {
  const { context: api } = server();
  let failBefore = 0;
  let loseReply = 0;
  let calls = 0;
  const retries = [];
  const unreliable = method => payload => {
    calls++;
    if (failBefore > 0) { failBefore--; throw new Error("NetworkError: Connection failure due to HTTP 0"); }
    const reply = api[method](payload);
    if (loseReply > 0) { loseReply--; throw new Error("NetworkError: Connection failure due to HTTP 0"); }
    return reply;
  };
  const storage = client({ loadEventJson: () => api.loadEventJson(), saveEventJson: unreliable("saveEventJson"), saveChangesJson: unreliable("saveChangesJson") });
  storage.retryDelays = [1, 2];
  storage.onretry = (error, delay) => retries.push([error.message, delay]);
  await storage.load();
  const event = fixture();

  // The server never sees the first two attempts; the third saves.
  failBefore = 2;
  await storage.save(event);
  assert.deepEqual(retries.map(entry => entry[1]), [1, 2]);
  assert.equal(api.loadEvent().revision, 1);

  // The save lands but its reply is lost: the retry is recognized, not applied again, and later saves continue.
  loseReply = 1;
  event.name = "Second";
  await storage.save(event);
  assert.equal(api.loadEvent().revision, 2);
  event.name = "Third";
  await storage.save(event);
  assert.equal(api.loadEvent().revision, 3);
  assert.equal(storage.conflicted, false);

  // A refusal is reported at once.
  calls = 0;
  await assert.rejects(storage.save({ ...event, sessionId: 5 }), /no longer fits/);
  assert.equal(calls, 1);
  assert.equal(storage.conflicted, true);
  await storage.load();

  // A connection that never returns gives up after the retry limit and stops further saves.
  storage.retryLimit = 20;
  failBefore = Infinity;
  event.name = "Fourth";
  await assert.rejects(storage.save(event), /NetworkError/);
  assert.equal(storage.conflicted, true);
});

test("change-based saves merge different pages' edits and refuse a second change to the same item", async () => {
  const History = require("./history.js");
  const Core = require("./core.js");
  const { context: api, grant, signIn } = server();
  const setup = fixture();
  setup.teams = [{ id: "1A", name: "One", draw: 0 }, { id: "2A", name: "Two", draw: 1 }];
  setup.matches = Core.schedule(setup.teams, 2);
  api.saveEvent({ revision: 0, requestId: "setup", event: setup });
  const score = (event, index, goals) => {
    event.matches[index].result = { counts: [goals, 0, 0, 0, 0], goals: Core.goalsFromCounts([goals, 0, 0, 0, 0]), statuses: { "1A": "ok", "2A": "ok" } };
    event.history.push(History.capture(event, "teamwork", event.matches[index], "posted"));
  };
  const first = client(api);
  const second = client(api);
  const one = await first.load();
  const two = await second.load();

  // Each page scores a different match without seeing the other's save; both are kept.
  score(one, 0, 2);
  await first.save(one);
  score(two, 1, 3);
  two.selected = 2;
  await second.save(two);
  assert.equal(second.conflicted, false);
  assert.equal(await second.hasNewer(), true, "the second page learns it is missing the first page's score");
  let stored = api.loadEvent().event;
  assert.deepEqual([...stored.matches.map(match => match.result?.counts[0] ?? null)], [2, 3]);
  assert.equal(stored.history.length, 2);
  assert.equal(stored.selected, 2);
  assert.equal(await first.hasNewer(), true);

  // Both pages correct match 1: the later correction is refused instead of replacing the earlier one.
  const fresh = await second.load();
  score(fresh, 0, 4);
  await second.save(fresh);
  score(one, 0, 1);
  await assert.rejects(first.save(one), /match Q1/);
  assert.equal(api.loadEvent().event.matches[0].result.counts[0], 4);
  const reloaded = await first.load();
  score(reloaded, 0, 1);
  await first.save(reloaded);
  assert.equal(api.loadEvent().event.matches[0].result.counts[0], 1);
  const stale = JSON.parse(JSON.stringify(two));
  stale.name = "Renamed";
  score(stale, 0, 7);
  const conflict = JSON.parse(api.saveChangesJson(JSON.stringify({ requestId: "stale", changes: require("./changes.js").diff(two, stale) })));
  assert.equal(conflict.code, "CONFLICT");
  assert.match(conflict.message, /match Q1/);
  assert.equal(api.loadEvent().event.name, "Shared test", "a conflicting save changes nothing");

  // Team members' change saves follow the same rules as full saves.
  grant([{ email: "student@nu-district.org", role: "member", team: "1A" }]);
  signIn("student@nu-district.org");
  const member = client(api);
  const event = await member.load();
  score(event, 1, 5);
  await assert.rejects(member.save(event), /Coach access required to score matches or skills/);
  const practice = await member.load();
  practice.history.push(History.practiceRecord(practice.history, practice.teams, { runRole: "member", mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([3, 0, 0, 0, 0]), occurredAt: "2026-10-04T12:00:00.000Z", notes: "Member run", status: "ok", optIn: false, stopTime: 0 }));
  practice.selected = 1;
  await member.save(practice);
  stored = api.loadEvent().event;
  assert.equal(stored.history.filter(record => record.source === "practice").length, 1);
  assert.equal(stored.selected, 1);
  const renamed = await member.load();
  renamed.name = "Student event";
  await assert.rejects(member.save(renamed), /Coach access required to change the event name/);
});

test("student run eligibility is enforced by both shared save protocols", () => {
  const History = require("./history.js");
  const Changes = require("./changes.js");
  const Core = require("./core.js");
  for (const protocol of ["event", "changes"]) {
    const { context: api, grant, signIn } = server();
    const setup = coachingFixture();
    api.saveEvent({ revision: 0, requestId: "setup", event: setup });
    grant([{ email: "student@nu-district.org", role: "member", team: "1A" }]);
    signIn("student@nu-district.org");
    const loaded = api.loadEvent();
    const input = {
      mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([10, 0, 0, 0, 0]),
      occurredAt: "2026-11-02T12:00:00Z", notes: "Student practice", status: "ok", optIn: false, stopTime: 0
    };
    const run = History.practiceRecord(loaded.event.history, loaded.event.teams, { ...input, runRole: "member" });
    const save = record => {
      const event = { ...loaded.event, history: [...loaded.event.history, record] };
      return protocol === "event"
        ? api.saveEvent({ revision: loaded.revision, requestId: History.newId(), event })
        : api.saveChanges({ requestId: History.newId(), changes: Changes.diff(loaded.event, event) });
    };
    for (const role of ["coach", undefined]) {
      const forged = { ...run };
      if (role === undefined) delete forged.runRole;
      else forged.runRole = role;
      assert.throws(() => save(forged), /must be marked as student runs/);
      assert.equal(api.loadEvent().revision, loaded.revision);
    }
    assert.equal(save(run).ok, true);
    assert.equal(History.skillsRanking(api.loadEvent().event.history)[0].driver, 1);
    assert.equal(History.teamAnalysis(api.loadEvent().event.history, "1A").modes.driver.best, 10);
    const tryPromotionAsMember = () => {
      const latest = api.loadEvent();
      const promotion = History.promotePractice(latest.event.history, run.runId);
      const event = { ...latest.event, history: [...latest.event.history, promotion] };
      return protocol === "event"
        ? api.saveEvent({ revision: latest.revision, requestId: History.newId(), event })
        : api.saveChanges({ requestId: History.newId(), changes: Changes.diff(latest.event, event) });
    };
    assert.throws(tryPromotionAsMember, /Coach access required to score matches or skills, or to edit or remove a practice run/);
    signIn("coach@nu-district.org");
    const current = api.loadEvent();
    const coachRun = History.practiceRecord(current.event.history, current.event.teams, { ...input, goals: Core.goalsFromCounts([2, 0, 0, 0, 0]) });
    const coachEvent = { ...current.event, history: [...current.event.history, coachRun] };
    const result = protocol === "event"
      ? api.saveEvent({ revision: current.revision, requestId: "coach-run", event: coachEvent })
      : api.saveChanges({ requestId: "coach-run", changes: Changes.diff(current.event, coachEvent) });
    assert.equal(result.ok, true);
    assert.equal(History.skillsRanking(api.loadEvent().event.history)[0].driver, 2);
    const beforePromotion = api.loadEvent();
    const promotion = History.promotePractice(beforePromotion.event.history, run.runId);
    const promotedEvent = { ...beforePromotion.event, history: [...beforePromotion.event.history, promotion] };
    const promoted = protocol === "event"
      ? api.saveEvent({ revision: beforePromotion.revision, requestId: "coach-promotion", event: promotedEvent })
      : api.saveChanges({ requestId: "coach-promotion", changes: Changes.diff(beforePromotion.event, promotedEvent) });
    assert.equal(promoted.ok, true);
    const promotedHistory = api.loadEvent().event.history;
    assert.equal(promotedHistory.find(record => record.id === run.id).runRole, "member", "the original student entry remains unchanged");
    assert.equal(History.resolve(promotedHistory).find(record => record.runId === run.runId).runRole, "coach");
    assert.equal(History.skillsRanking(promotedHistory)[0].driver, 10);
  }
});

test("change-based saves cannot erase or rewrite score history, and members cannot restore deleted practice runs", () => {
  const History = require("./history.js");
  const Core = require("./core.js");
  const Changes = require("./changes.js");
  const { context: api, grant, signIn } = server();
  const setup = fixture();
  setup.teams = [{ id: "1A", name: "One", draw: 0 }, { id: "2A", name: "Two", draw: 1 }];
  const run = History.practiceRecord([], setup.teams, { mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([4, 0, 0, 0, 0]), occurredAt: "2026-10-04T12:00:00.000Z", notes: "Coach run", status: "ok", optIn: false, stopTime: 0 });
  setup.history.push(run);
  api.saveEvent({ revision: 0, requestId: "setup", event: setup });
  const save = changes => JSON.parse(api.saveChangesJson(JSON.stringify({ requestId: crypto.randomUUID(), changes })));
  const stored = () => api.loadEvent().event;

  // Coach: replacing the history wholesale, or rewriting a record through any route, is refused.
  const current = stored();
  for (const changes of [
    [{ type: "value", key: "history", before: current.history, after: [] }],
    [{ type: "history", records: [{ ...current.history[0], notes: "Rewritten" }] }]
  ]) assert.notEqual(save(changes).ok, true);
  assert.equal(stored().history.length, 1);
  assert.equal(stored().history[0].notes, "Coach run");

  // The coach deletes the run; a member cannot bring it back under the same run identity, for any team.
  const removed = stored();
  removed.history.push(History.removePractice(removed.history, run.runId));
  assert.equal(save(Changes.diff(stored(), removed)).ok, true);
  grant([{ email: "student@nu-district.org", role: "member", team: "2A" }]);
  signIn("student@nu-district.org");
  const before = stored();
  const restore = { ...run, id: History.newId(), action: "posted", notes: "Restored", recordedAt: new Date().toISOString() };
  const response = save([{ type: "history", records: [restore] }]);
  assert.equal(response.code, "REFUSED");
  assert.match(response.message, /Coach access required/);
  const snapshot = JSON.parse(JSON.stringify(before));
  snapshot.history.push(restore);
  assert.throws(() => api.saveEvent({ revision: api.loadEvent().revision, requestId: "restore", event: snapshot }), /Coach access required/);
  assert.equal(History.resolve(stored().history).length, 0);
});

test("server refusals are returned as REFUSED instead of failing the call", () => {
  const { context: api, signIn } = server();
  api.saveEvent({ revision: 0, requestId: "coach", event: fixture() });
  signIn("parent@gmail.com");
  const response = JSON.parse(api.saveEventJson(JSON.stringify({ revision: 1, requestId: "viewer", event: fixture() })));
  assert.equal(response.ok, false);
  assert.equal(response.code, "REFUSED");
  assert.match(response.message, /Read-only access/);
});

test("JSON RPC avoids nested-object transport transformations", async () => {
  const { context: api } = server();
  const storage = client({
    loadEventJson() { return api.loadEventJson(); },
    saveEventJson(payload) {
      assert.equal(typeof payload, "string");
      return api.saveEventJson(payload);
    }
  });
  await storage.load();
  const event = fixture();
  event.teams = [{ id: "1A", name: "One", draw: 0 }, { id: "2A", name: "Two", draw: 1 }];
  event.matches = [{ id: 1, round: 1, teams: ["1A", "2A"], surrogate: null, result: null }];
  await storage.save(event);
  assert.deepEqual(JSON.parse(JSON.stringify(EventModel.validate(await storage.load()))), event);
});

test("invalid saved matches identify the failing position and field", () => {
  const event = fixture();
  event.matches = [{ id: 1, round: 1, teams: ["1A", "2A"] }];
  event.teams = [{ id: "1A", name: "One", draw: 0 }, { id: "2A", name: "Two", draw: 1 }];
  assert.throws(() => EventModel.validate(event), /position 1: surrogate.*undefined/);
});

test("schedule selections persist through shared saves, edits, and reloads with legacy defaults", async () => {
  const event = fixture();
  event.teams = [{ id: "1A", name: "One", draw: 0, includeInSchedule: false }, { id: "2A", name: "Two", draw: 1 }];
  const { context: api } = server();
  const storage = client(api);
  await storage.load();
  await storage.save(event);
  const restored = await storage.load();
  assert.equal(restored.teams[0].includeInSchedule, false);
  assert.equal(restored.teams[1].includeInSchedule, undefined);
  const edited = require("./core.js").editTeam(restored.teams, [], "1A", "9Z", "Renamed");
  assert.equal(edited.teams[0].includeInSchedule, false);
  assert.throws(() => EventModel.validate({ ...event, teams: [{ ...event.teams[0], includeInSchedule: "false" }] }), /inclusion/);
});

test("shared practice runs persist, preserve audit history, and leave the active event alone", async () => {
  const History = require("./history.js");
  const Core = require("./core.js");
  const event = fixture();
  event.teams = [{ id: "1A", name: "One", draw: 0 }, { id: "2A", name: "Two", draw: 1 }];
  event.matches = Core.schedule(event.teams, 2);
  const schedule = JSON.stringify(event.matches);
  const { context: api } = server();
  const storage = client(api);
  await storage.load();
  const run = History.practiceRecord([], event.teams, { mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([4, 0, 0, 0, 0]), occurredAt: "2026-10-29T10:00:00Z", notes: "Practice", status: "ok", optIn: false, stopTime: 0 });
  event.history.push(run);
  await storage.save(event);
  const restored = await storage.load();
  assert.equal(restored.history[0].runId, run.runId);
  assert.equal(JSON.stringify(restored.matches), schedule);
  assert.equal(restored.skills.length, 0);
  restored.history.push(History.removePractice(restored.history, run.runId));
  await storage.save(restored);
  const final = await storage.load();
  assert.equal(final.history.length, 2);
  assert.equal(History.resolve(final.history).length, 0);
});

test("shared notebook reviews round trip as a history and edits keep the review", async () => {
  const Rubric = require("./rubric.js");
  const event = fixture();
  const team = { id: "1A", name: "One", draw: 0 };
  event.teams = [team];
  const input = {
    evaluatedOn: "2026-10-29", reviewer: "Coach", overallNotes: "Feedback",
    scores: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, 3])),
    notes: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, "Evidence"]))
  };
  const { context: api } = server();
  const storage = client(api);
  await storage.load();
  event.rubrics = Rubric.save(event.rubrics, team, input);
  await storage.save(event);
  const restored = await storage.load();
  assert.equal(restored.rubrics[0].notes.code, "Evidence");
  restored.rubrics = Rubric.save(restored.rubrics, team, { ...input, evaluatedOn: "2026-11-05", overallNotes: "Second review" });
  await storage.save(restored);
  const second = await storage.load();
  assert.equal(second.rubrics.length, 2);
  assert.deepEqual([...Rubric.reviews(second.rubrics, "1A").map(entry => entry.overallNotes)], ["Feedback", "Second review"]);
  second.rubrics = Rubric.save(second.rubrics, team, { ...input, overallNotes: "Edited first" }, second.rubrics[0].id);
  await storage.save(second);
  const final = await storage.load();
  assert.equal(final.rubrics.length, 2);
  assert.equal(final.rubrics[0].overallNotes, "Edited first");
  assert.equal(final.rubrics[0].id, second.rubrics[0].id);
  assert.equal(final.history.length, 0);
});

test("shared interview reviews persist independently of notebook scores", async () => {
  const Rubric = require("./rubric.js");
  const Interview = Rubric.Interview;
  const event = fixture();
  const team = { id: "1A", name: "One", draw: 0 };
  event.teams = [team];
  const input = {
    evaluatedOn: "2026-10-29", reviewer: "Coach", overallNotes: "Interview notes",
    scores: Object.fromEntries(Interview.criteria.map(({ id }) => [id, 0])),
    notes: Object.fromEntries(Interview.criteria.map(({ id }) => [id, "Evidence"]))
  };
  const notebook = {
    ...input, scores: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, 4])),
    notes: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, "Notebook evidence"]))
  };
  event.rubrics = Rubric.save([], team, notebook);
  event.interviews = Interview.save([], team, input);
  const { context: api } = server();
  const storage = client(api);
  await storage.load();
  await storage.save(event);
  const restored = await storage.load();
  assert.equal(restored.interviews[0].scores.evidence, 0);
  restored.interviews = Interview.save(restored.interviews, team, { ...input, overallNotes: "Updated" });
  await storage.save(restored);
  const final = await storage.load();
  assert.equal(final.interviews.length, 2);
  assert.equal(final.interviews[1].overallNotes, "Updated");
  assert.equal(final.rubrics.length, 1);
  assert.equal(final.rubrics[0].scores.code, 4);
  assert.equal(final.history.length, 0);
});
