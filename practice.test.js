"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const History = require("./history.js");
const Core = require("./core.js");
const EventModel = require("./event.js");
const teams = [{ id: "1A", name: "One", draw: 0 }, { id: "2A", name: "Two", draw: 1 }];
const input = (overrides = {}) => ({
  mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([5, 0, 0, 0, 0]),
  occurredAt: "2026-10-29T10:00:00.000Z", notes: "New routine",
  status: "ok", optIn: false, stopTime: 0, ...overrides
});

test("student quick runs stay in history and analysis but never affect any leaderboard", () => {
  const Rubric = require("./rubric.js");
  for (const mode of ["driver", "autonomous", "teamwork"]) {
    const options = mode === "teamwork" ? { mode, teams: ["1A", "2A"], statuses: { "1A": "ok", "2A": "ok" } } : { mode };
    const coach = History.practiceRecord([], teams, input(options));
    const student = History.practiceRecord([coach], teams, input({ ...options, runRole: "member", goals: Core.goalsFromCounts([10, 0, 0, 0, 0]) }));
    const history = [coach, student];
    for (const rank of [History.skillsRanking, History.teamworkRanking, Rubric.combinedRanking]) {
      assert.deepEqual(rank(history, teams), rank([coach], teams));
      assert.deepEqual(rank([student], teams), rank([], teams));
    }
    assert.equal(History.teamAnalysis(history, "1A").modes[mode].count, 2);
    assert.equal(History.teamAnalysis(history, "1A").modes[mode].best, 10);
    assert.equal(History.resolve(history).length, 2);
    assert.equal(History.filterSource(history, "practice").length, 2);
    const edited = History.practiceRecord(history, teams, input({ ...options, runRole: "coach" }), student.runId);
    assert.equal(edited.runRole, "member", "a coach correction does not promote a student run");
    const removed = History.removePractice([...history, edited], student.runId);
    assert.equal(removed.runRole, "member");
    assert.deepEqual(History.merge([], JSON.parse(JSON.stringify(history))), history);
    assert.match(History.csv([student]), /"Practice run role"/);
    assert.match(History.csv([student]), /"member"/);
    const legacy = { ...coach };
    delete legacy.runRole;
    for (const rank of [History.skillsRanking, History.teamworkRanking, Rubric.combinedRanking]) {
      assert.deepEqual(rank([legacy], teams), rank([coach], teams));
    }
  }
});

test("standalone practice permits unlimited distinct attempts without touching event slots", () => {
  const history = [];
  for (let index = 0; index < 12; index++) history.push(History.practiceRecord(history, teams, input()));
  assert.equal(History.resolve(history).length, 12);
  assert.equal(new Set(history.map(record => record.runId)).size, 12);
  const event = { version: 1, name: "Event", sessionId: History.newId(), teams, matches: Core.schedule(teams, 1), skills: [], skillsOnly: false, rounds: 1, start: "09:00", interval: 3, selected: 1, history };
  const before = JSON.stringify({ matches: event.matches, skills: event.skills, sessionId: event.sessionId });
  EventModel.validate(event);
  assert.equal(JSON.stringify({ matches: event.matches, skills: event.skills, sessionId: event.sessionId }), before);
  assert.ok(event.matches.every(match => match.result === null));
  assert.equal(History.skillsRanking(history, teams)[0].total, 5);
  assert.equal(History.teamAnalysis(history, "1A").modes.driver.count, 12);
});

test("practice corrections retain identity even when mode or participants change", () => {
  const first = History.practiceRecord([], teams, input());
  const corrected = History.practiceRecord([first], teams, input({ mode: "autonomous", teams: ["2A"] }), first.runId);
  assert.equal(corrected.runId, first.runId);
  assert.equal(corrected.sessionId, first.sessionId);
  assert.notEqual(corrected.id, first.id);
  assert.equal(corrected.action, "updated");
  assert.equal(History.resolve([first, corrected]).length, 1);
  assert.equal(History.teamAnalysis([first, corrected], "1A").modes.driver.count, 0);
  assert.equal(History.teamAnalysis([first, corrected], "2A").modes.autonomous.count, 1);
  const removed = History.removePractice([first, corrected], first.runId);
  assert.equal(History.resolve([first, corrected, removed]).length, 0);
  assert.equal(removed.notes, "New routine");
  assert.throws(() => History.practiceRecord([first, corrected, removed], teams, input(), first.runId), /no longer exists/);
  assert.throws(() => History.removePractice([], first.runId), /no longer exists/);
});

test("practice teamwork uses shared scores and status-adjusted zeros in partner analysis", () => {
  const run = History.practiceRecord([], teams, input({ mode: "teamwork", teams: ["1A", "2A"], statuses: { "1A": "dq", "2A": "ok" } }));
  assert.equal(run.kind, "teamwork");
  assert.equal(run.value.surrogate, null);
  assert.equal(History.teamAnalysis([run], "1A").modes.teamwork.average, 0);
  assert.equal(History.teamAnalysis([run], "2A").modes.teamwork.average, 5);
  assert.equal(History.teamAnalysis([run], "1A").partners[0].fieldAverage, 5);
});

test("source filters include legacy events and consistently separate practice rankings and trends", () => {
  const event = { sessionId: History.newId(), name: "Event", skillsOnly: true, teams };
  const original = History.capture(event, "skills", { team: "1A", mode: "driver", attempt: 1, counts: [9, 0, 0, 0, 0], status: "ok", optIn: false, stopTime: 0 }, "posted");
  const practice = History.practiceRecord([], teams, input());
  const records = [original, practice];
  assert.equal(History.filterSource(records).length, 2);
  assert.deepEqual(History.filterSource(records, "event"), [original]);
  assert.deepEqual(History.filterSource(records, "practice"), [practice]);
  assert.equal(History.skillsRanking(History.filterSource(records, "practice"), teams)[0].driver, 5);
  assert.equal(History.skillsRanking(History.filterSource(records, "event"), teams)[0].driver, 9);
  assert.equal(History.teamAnalysis(History.filterSource(records, "practice"), "1A").modes.driver.timed[0].recordedAt, practice.occurredAt);
  assert.throws(() => History.filterSource(records, "invalid"), /Invalid analysis source/);
});

test("practice dates, notes, stop times and team selections are validated", () => {
  for (const overrides of [
    { teams: [] }, { teams: ["missing"] }, { mode: "teamwork", teams: ["1A", "1A"] },
    { occurredAt: "bad date" }, { notes: "x".repeat(1001) }, { goals: Core.goalsFromCounts([0, 0, 0, 0, 0]), stopTime: 61, optIn: true },
    { status: "unknown" }, { optIn: false, stopTime: 1 }, { mode: "fourth" },
    { runRole: "other" }, { runRole: "" }, { runRole: null }
  ]) assert.throws(() => History.practiceRecord([], teams, input(overrides)));
  const stopped = History.practiceRecord([], teams, input({ optIn: true, stopTime: 17 }));
  assert.equal(stopped.value.stopTime, 17);
  const invalid = { ...stopped, sessionId: "event" };
  assert.throws(() => History.validate([invalid]), /metadata/);
});

test("practice timestamps preserve run chronology after corrections", () => {
  const first = History.practiceRecord([], teams, input({ occurredAt: "2026-01-01T10:00:00Z" }));
  const next = History.practiceRecord([first], teams, input({ occurredAt: "2026-02-01T10:00:00Z" }));
  const corrected = History.practiceRecord([first, next], teams, input({ occurredAt: first.occurredAt }), first.runId);
  assert.deepEqual(History.teamAnalysis([first, next, corrected], "1A").modes.driver.timed.map(entry => entry.recordedAt), [first.occurredAt, next.occurredAt]);
});

test("CSV and backup round trips retain practice metadata and safely escape notes", () => {
  const run = History.practiceRecord([], teams, input({ notes: '=SUM(1,2) "notes"' }));
  const copy = JSON.parse(JSON.stringify(run));
  assert.deepEqual(History.merge([run], [copy]), [run]);
  const csv = History.csv([run]);
  assert.ok(csv.includes('"Source","Practice run ID","Run time (UTC)","Notes"'));
  assert.ok(csv.includes(`"practice","${run.runId}","${run.occurredAt}"`));
  assert.ok(csv.includes(`"'=SUM(1,2) ""notes"""`));
});
