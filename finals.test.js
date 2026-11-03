"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const Finals = require("./finals.js");
const History = require("./history.js");
const EventModel = require("./event.js");

function fixture(count = 6) {
  const teams = Array.from({ length: count }, (_, index) => ({ id: `${index + 1}A`, name: `Team ${index + 1}`, draw: index }));
  const matches = [];
  for (let index = 0; index + 1 < count; index += 2) {
    const pair = teams.slice(index, index + 2).map(team => team.id);
    matches.push({ id: matches.length + 1, round: 1, teams: pair, surrogate: null, result: { counts: [count - index, 0, 0, 0, 0], statuses: Object.fromEntries(pair.map(id => [id, "ok"])) } });
  }
  return EventModel.validate({ version: 1, teams, matches, rounds: 6, start: "09:00", interval: 3, name: "Finals test", selected: 1, skills: [], history: [] });
}

function post(match, points, stopTime = 0, statuses = {}) {
  match.result = { counts: [points, 0, 0, 0, 0], stopTime, statuses: Object.fromEntries(match.teams.map(id => [id, statuses[id] || "ok"])) };
  return match;
}

function tiedFinals() {
  const event = fixture();
  event.finals = Finals.generate(event.teams, event.matches, 6);
  event.finals.forEach(match => post(match, match.seed === 3 ? 5 : 20));
  return event;
}

test("T12 adjacent qualification pairings, excluded roster teams, and T14 lowest-seed-first order", () => {
  const event = fixture();
  event.teams.push({ id: "EX", name: "Excluded", draw: -1, includeInSchedule: false });
  const before = structuredClone(event.matches);
  const matches = Finals.generate(event.teams, event.matches, 4);
  assert.deepEqual(matches.map(match => [match.id, match.seed, match.teams]), [[1, 2, ["3A", "4A"]], [2, 1, ["1A", "2A"]]]);
  assert.ok(matches.every(match => match.round === 1 && match.phase === "finals" && match.result === null && match.surrogate === null));
  assert.deepEqual(event.matches, before);
  assert.equal(Finals.eligible(event.teams, event.matches).length, 6);
});

test("finals require all qualifications posted and an even advancing count in range", () => {
  const event = fixture();
  for (const count of [0, 1, 3, 8, 2.5, NaN]) assert.throws(() => Finals.generate(event.teams, event.matches, count), /even number/);
  event.matches[0].result = null;
  assert.throws(() => Finals.generate(event.teams, event.matches, 2), /every qualification/);
  assert.throws(() => Finals.generate(event.teams, [], 2), /every qualification/);
});

test("finals never affect qualification averages, and lower-place ties favor seed", () => {
  const event = fixture();
  const before = Core.standings(event.teams, event.matches);
  event.finals = Finals.generate(event.teams, event.matches, 6);
  event.finals.forEach(match => post(match, match.seed === 3 ? 30 : 10));
  assert.deepEqual(Core.standings(event.teams, event.matches), before);
  const status = Finals.outcome(event.finals);
  assert.equal(status.complete, true);
  assert.equal(status.champion, 3);
  assert.deepEqual(status.rows.map(row => [row.rank, row.seed]), [[1, 3], [2, 1], [3, 2]]);
});

test("an unscored final cannot declare champions or generate tiebreakers", () => {
  const event = tiedFinals();
  event.finals[0].result = null;
  assert.equal(Finals.outcome(event.finals).complete, false);
  assert.equal(Finals.outcome(event.finals).champion, null);
  assert.throws(() => Finals.tiebreakers(event.finals), /Finish/);
});

test("T14 first-place ties require a complete tiebreaker series, in seed order", () => {
  const event = tiedFinals();
  let status = Finals.outcome(event.finals);
  assert.equal(status.complete, false);
  assert.equal(status.nextRound, 2);
  assert.deepEqual(status.pending, [1, 2]);
  const ties = Finals.tiebreakers(event.finals);
  assert.deepEqual(ties.map(match => [match.id, match.seed, match.round]), [[4, 2, 2], [5, 1, 2]]);
  event.finals.push(...ties);
  post(ties[0], 15);
  assert.equal(Finals.outcome(event.finals).champion, null);
  post(ties[1], 12, 50);
  status = Finals.outcome(event.finals);
  assert.equal(status.champion, 2, "score takes precedence over Stop Time");
  assert.deepEqual(status.rows.map(row => row.seed), [2, 1, 3]);
  assert.doesNotThrow(() => EventModel.validate(event));
});

test("equal first-tiebreaker scores compare Stop Time before requesting another series", () => {
  const event = tiedFinals();
  const ties = Finals.tiebreakers(event.finals);
  ties.forEach(match => post(match, 20, match.seed === 2 ? 10 : 9));
  event.finals.push(...ties);
  assert.equal(Finals.outcome(event.finals).champion, 2);
  assert.equal(Finals.outcome(event.finals).nextRound, null);
});

test("two tied tiebreaker series fall back to higher seed without a third series", () => {
  const event = tiedFinals();
  const first = Finals.tiebreakers(event.finals);
  first.forEach(match => post(match, 15, 5));
  event.finals.push(...first);
  assert.equal(Finals.outcome(event.finals).nextRound, 3);
  const second = Finals.tiebreakers(event.finals);
  second.forEach(match => post(match, 14, 8));
  event.finals.push(...second);
  assert.equal(Finals.outcome(event.finals).champion, 1);
  assert.equal(Finals.outcome(event.finals).complete, true);
  assert.throws(() => Finals.tiebreakers(event.finals), /Finish/);
  assert.doesNotThrow(() => EventModel.validate(event));
});

test("three-way ties narrow contenders and retain nonchampion ordering", () => {
  const event = tiedFinals();
  event.finals.forEach(match => post(match, 10));
  const first = Finals.tiebreakers(event.finals);
  first.forEach(match => post(match, match.seed === 1 ? 5 : 15, 4));
  event.finals.push(...first);
  const second = Finals.tiebreakers(event.finals);
  assert.deepEqual(second.map(match => match.seed), [3, 2]);
  second.forEach(match => post(match, 12, match.seed === 3 ? 10 : 5));
  event.finals.push(...second);
  assert.deepEqual(Finals.outcome(event.finals).rows.map(row => row.seed), [3, 1, 2]);
  assert.doesNotThrow(() => EventModel.validate(event));
});

test("finals DQ zeros the alliance; a single no-show does not erase the partner's score", () => {
  const event = fixture();
  const [match] = Finals.generate(event.teams, event.matches, 2);
  post(match, 20, 0, { "1A": "dq" });
  assert.equal(Finals.score(match), 0);
  event.history.push(History.capture(event, "teamwork", match, "posted"));
  assert.ok(History.teamworkRanking(event.history).every(row => row.best === 0));
  post(match, 20, 0, { "1A": "absent" });
  assert.equal(Finals.score(match), 20);
  post(match, 20, 0, { "1A": "absent", "2A": "absent" });
  assert.equal(Finals.score(match), 0);
});

test("old backups gain empty finals while finals state and selection survive JSON roundtrip", () => {
  const event = fixture();
  assert.deepEqual(event.finals, []);
  assert.deepEqual(event.finalsWithdrawn, []);
  assert.equal(event.selectedPhase, "qualification");
  event.finals = Finals.generate(event.teams, event.matches, 4);
  event.selectedPhase = "finals"; event.selected = 2;
  const loaded = EventModel.validate(JSON.parse(JSON.stringify(event)));
  assert.deepEqual(loaded, event);
  const bad = structuredClone(event);
  bad.selected = 3;
  assert.throws(() => EventModel.validate(bad), /selected match/);
});

test("malformed finals schedules, phases, Stop Time, and tie participants are rejected", () => {
  const event = tiedFinals();
  for (const mutate of [
    copy => { copy.finals[0] = null; },
    copy => { copy.finals[0].id = 3; },
    copy => { copy.finals[0].seed = 1; },
    copy => { copy.finals[0].teams = copy.finals[1].teams; },
    copy => { copy.finals[0].phase = "qualification"; },
    copy => { copy.finals[0].result.stopTime = 1; },
    copy => { copy.finals[0].result.statuses = {}; },
    copy => { copy.matches[0].result = null; }
  ]) {
    const copy = structuredClone(event); mutate(copy);
    assert.throws(() => EventModel.validate(copy));
  }
  const ties = Finals.tiebreakers(event.finals);
  event.finals.push(...ties);
  event.finals.at(-1).seed = 3;
  assert.throws(() => EventModel.validate(event), /participants/);
});

test("backups reject reseeded alliances and duplicate tiebreaker slots", () => {
  const event = tiedFinals();
  const reseeded = structuredClone(event);
  [reseeded.finals[0].teams, reseeded.finals[1].teams] = [reseeded.finals[1].teams, reseeded.finals[0].teams];
  for (const match of reseeded.finals) post(match, 20);
  assert.throws(() => EventModel.validate(reseeded), /adjacent qualification/);
  const ties = Finals.tiebreakers(event.finals);
  event.finals.push(...ties);
  event.finals.push({ ...ties[1], id: event.finals.length + 1 });
  assert.throws(() => EventModel.validate(event), /Duplicate/);
  const invalidStop = tiedFinals();
  invalidStop.finals.push(...Finals.tiebreakers(invalidStop.finals));
  post(invalidStop.finals.at(-1), 10, 61);
  assert.throws(() => EventModel.validate(invalidStop), /Stop Time/);
});

test("tiebreaker no-shows cannot use a recorded Stop Time to win a zero-score tie", () => {
  const event = tiedFinals();
  const ties = Finals.tiebreakers(event.finals);
  ties.forEach(match => post(match, 0, match.seed === 2 ? 60 : 1, match.seed === 2 ? Object.fromEntries(match.teams.map(id => [id, "absent"])) : {}));
  event.finals.push(...ties);
  assert.equal(Finals.outcome(event.finals).champion, 1);
});

test("voided tiebreakers can be regenerated without erasing audit or qualification scores", () => {
  const event = tiedFinals();
  event.history = event.matches.map(match => History.capture(event, "teamwork", match, "posted"));
  const ties = Finals.tiebreakers(event.finals);
  ties.forEach(match => {
    post(match, 10, 5);
    event.history.push(History.capture(event, "teamwork", match, "posted"));
    event.history.push(History.capture(event, "teamwork", match, "voided"));
  });
  assert.equal(History.resolve(event.history).length, event.matches.length);
  const regenerated = Finals.tiebreakers(event.finals);
  regenerated.forEach(match => {
    post(match, 12, 4);
    event.history.push(History.capture(event, "teamwork", match, "posted"));
  });
  assert.equal(History.resolve(event.history).length, event.matches.length + 2);
  assert.equal(event.history.length, event.matches.length + 6);
});

test("team renumbering preserves final alliances, seed order, and historical snapshots", () => {
  const event = tiedFinals();
  event.history = [History.capture(event, "teamwork", event.finals.find(match => match.seed === 1), "posted")];
  const renamed = Core.editTeam(event.teams, event.matches, "1A", "NEW1", "New one");
  const finalEdit = Core.editTeam(event.teams, event.finals, "1A", "NEW1", "New one");
  event.teams = renamed.teams; event.matches = renamed.matches; event.finals = finalEdit.matches;
  assert.doesNotThrow(() => EventModel.validate(event));
  assert.ok(event.history[0].value.teams.includes("1A"));
  assert.ok(event.finals.find(match => match.seed === 1).teams.includes("NEW1"));
});

test("qualification and finals match IDs resolve independently, with corrections and voids preserved", () => {
  const event = fixture();
  event.finals = Finals.generate(event.teams, event.matches, 2);
  post(event.finals[0], 20);
  event.history.push(History.capture(event, "teamwork", event.matches[0], "posted"), History.capture(event, "teamwork", event.finals[0], "posted"));
  assert.equal(History.resolve(event.history).length, 2);
  const correction = structuredClone(event.finals[0]);
  post(correction, 25);
  event.history.push(History.capture(event, "teamwork", correction, "updated"));
  assert.equal(History.resolve(event.history).length, 2);
  assert.equal(History.teamworkRanking(event.history)[0].best, 25);
  assert.equal(History.teamAnalysis(event.history, "1A").modes.teamwork.entries.find(entry => entry.label === "F1").score, 25);
  event.history.push(History.capture(event, "teamwork", correction, "voided"));
  assert.equal(History.resolve(event.history).length, 1);
  assert.equal(event.history.length, 4);
});

test("finals CSV distinguishes match phase and alliance seed and includes tiebreaker Stop Time", () => {
  const event = tiedFinals();
  const [match] = Finals.tiebreakers(event.finals);
  post(match, 20, 12);
  const csv = History.csv([History.capture(event, "teamwork", match, "posted")]);
  const rows = csv.split("\r\n").map(line => line.split(",").map(cell => cell.slice(1, -1)));
  assert.equal(rows[1][rows[0].indexOf("Match phase")], "finals");
  assert.equal(rows[1][rows[0].indexOf("Finals alliance seed")], "2");
  assert.equal(rows[1][rows[0].indexOf("Stop time seconds")], "12");
  const practice = History.practiceRecord([], event.teams, { mode: "teamwork", teams: ["1A", "2A"], goals: Core.goalsFromCounts([3, 0, 0, 0, 0]), occurredAt: "2026-10-30T12:00:00Z", notes: "", statuses: { "1A": "ok", "2A": "ok" } });
  const phaseRows = History.csv([History.capture(event, "teamwork", event.matches[0], "posted"), practice]).split("\r\n").map(line => line.split(","));
  const phases = phaseRows.slice(1).map(row => row[phaseRows[0].indexOf('"Match phase"')]);
  assert.deepEqual(phases, ['"qualification"', '"qualification"', '"practice"', '"practice"']);
});

test("T12C withdrawals use the next available ranked team, then permit a solo alliance", () => {
  const event = fixture();
  event.finals = Finals.generate(event.teams, event.matches, 4);
  let updated = Finals.withdraw(event.teams, event.matches, event.finals, [], "1A");
  assert.equal(updated.replacement, "5A");
  updated = Finals.withdraw(event.teams, event.matches, updated.matches, updated.withdrawn, "5A");
  assert.equal(updated.replacement, "6A");
  updated = Finals.withdraw(event.teams, event.matches, updated.matches, updated.withdrawn, "6A");
  assert.equal(updated.replacement, null);
  event.finals = updated.matches; event.finalsWithdrawn = updated.withdrawn;
  assert.deepEqual(event.finals.find(match => match.seed === 1).teams, ["2A"]);
  assert.doesNotThrow(() => EventModel.validate(event));
  const solo = event.finals.find(match => match.seed === 1);
  post(solo, 12);
  event.history.push(History.capture(event, "teamwork", solo, "posted"));
  assert.doesNotThrow(() => History.teamAnalysis(event.history, "2A"));
  assert.doesNotThrow(() => History.csv(event.history));
  assert.throws(() => Finals.withdraw(event.teams, event.matches, event.finals, event.finalsWithdrawn, "2A"), /before/);
});
