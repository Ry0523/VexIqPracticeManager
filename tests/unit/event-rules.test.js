"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { score, dropCount, schedule, standings, editTeam, goalCounts, goalsFromCounts, validateSkills, saveSkillAttempt, skillsStandings } = require("../../event-rules.js");
const teams = Array.from({ length: 5 }, (_, index) => ({ id: `${index + 1}A`, name: `Team ${index + 1}`, draw: index }));
const result = (value, status = "ok") => ({ counts: [value, 0, 0, 0, 0], statuses: { "1A": status } });
const history = values => values.map((value, index) => ({ id: index + 1, teams: ["1A", "2A"], surrogate: null, result: result(value) }));

test("IQ scoring weights and 38-bag limit", () => {
  assert.equal(score([1, 1, 1, 1, 1]), 38);
  assert.equal(score([0, 0, 0, 0, 38]), 608);
  for (const counts of [[39, 0, 0, 0, 0], [1.5, 0, 0, 0, 0], [-1, 0, 0, 0, 0], []]) assert.throws(() => score(counts));
});

test("T10 drop thresholds", () => {
  assert.deepEqual([0, 3, 4, 7, 8, 11, 12, 15, 16, 30].map(dropCount), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test("balanced schedules count each regular appearance exactly once per round", () => {
  for (let count = 2; count <= 20; count++) {
    const roster = Array.from({ length: count }, (_, index) => ({ id: String(index) }));
    const matches = schedule(roster, 6);
    assert.equal(matches.length, Math.ceil(count / 2) * 6);
    for (const team of roster) assert.equal(matches.filter(match => match.teams.includes(team.id) && match.surrogate !== team.id).length, 6);
    assert.ok(matches.every(match => match.teams[0] !== match.teams[1]));
  }
  assert.throws(() => schedule([], 6));
  assert.throws(() => schedule(teams, 0));
});

test("ranked average drops the lowest completed score", () => {
  const row = standings(teams.slice(0, 2), history([2, 10, 20, 30]))[0];
  assert.equal(row.average, 20);
  assert.deepEqual(row.excluded, [1]);
});

test("schedules omit excluded teams including surrogate appearances without altering the roster", () => {
  const roster = teams.map((team, index) => ({ ...team, includeInSchedule: index < 3 }));
  const matches = schedule(roster, 6);
  assert.equal(matches.length, 12);
  assert.ok(matches.every(match => match.teams.every(id => roster.slice(0, 3).some(team => team.id === id))));
  for (const team of roster.slice(0, 3)) assert.equal(matches.filter(match => match.teams.includes(team.id) && match.surrogate !== team.id).length, 6);
  assert.equal(roster.length, 5);
  assert.equal(roster[3].includeInSchedule, false);
  assert.throws(() => schedule(roster.map((team, index) => ({ ...team, includeInSchedule: index === 0 })), 6), /at least two/);
  assert.throws(() => schedule(roster.map(team => ({ ...team, includeInSchedule: false })), 6), /at least two/);
});

test("T11 tiebreakers never remove a protected no-show zero", () => {
  const played = (team, values) => values.map(([value, status], index) => ({ id: index + 1, teams: [team, "9Z"], surrogate: null, result: { counts: [value, 0, 0, 0, 0], statuses: { [team]: status, "9Z": "ok" } } }));
  const matches = [...played("1A", [[0, "absent"], [30, "ok"], [30, "ok"]]), ...played("2A", [[10, "ok"], [20, "ok"], [30, "ok"]])];
  const rows = standings(teams.slice(0, 2).map((team, index) => ({ ...team, draw: 1 - index })), matches);
  assert.equal(rows[0].average, rows[1].average);
  assert.deepEqual(rows.map(row => row.id), ["2A", "1A"]);
  assert.deepEqual(rows[1].tiebreakOrder, [score([30, 0, 0, 0, 0]), score([30, 0, 0, 0, 0])]);
});

test("no-show zero is protected, DQ zero is eligible, surrogate is ignored", () => {
  const matches = history([2, 10, 20, 30]);
  matches[0].result = result(2, "absent");
  let row = standings(teams, matches).find(team => team.id === "1A");
  assert.equal(row.average, 50 / 3);
  assert.deepEqual(row.excluded, [2]);
  matches[0].result = result(2, "dq");
  row = standings(teams, matches).find(team => team.id === "1A");
  assert.equal(row.average, 20);
  matches[0].surrogate = "1A";
  row = standings(teams, matches).find(team => team.id === "1A");
  assert.equal(row.played, 3);
  assert.equal(row.average, 20);
});

test("T11 removes successive lowest scores, then uses persisted random draw", () => {
  const matches = [
    { id: 1, teams: ["1A", "3A"], result: result(10) },
    { id: 2, teams: ["1A", "3A"], result: result(30) },
    { id: 3, teams: ["2A", "3A"], result: result(20) },
    { id: 4, teams: ["2A", "3A"], result: result(20) }
  ];
  assert.equal(standings(teams.slice(0, 2), matches)[0].id, "1A");
  assert.equal(standings([{ ...teams[0], draw: 2 }, { ...teams[1], draw: 1 }], history([10]))[0].id, "2A");
});

test("editing a team preserves scores, no-shows, extra appearances, and random draw", () => {
  const matches = history([2, 10, 20, 30]);
  matches[0].result = result(2, "absent");
  matches[1].surrogate = "1A";
  const before = standings(teams, matches).find(team => team.id === "1A");
  const edited = editTeam(teams, matches, "1A", " 9z ", " Updated name ");
  const after = standings(edited.teams, edited.matches).find(team => team.id === "9Z");
  assert.equal(after.name, "Updated name");
  assert.equal(after.draw, before.draw);
  assert.equal(after.average, before.average);
  assert.equal(after.played, before.played);
  assert.equal(edited.matches[0].result.statuses["9Z"], "absent");
  assert.equal(edited.matches[0].result.statuses["1A"], undefined);
  assert.equal(edited.matches[1].surrogate, "9Z");
  assert.deepEqual(edited.matches[2].result.counts, matches[2].result.counts);
  assert.equal(teams[0].id, "1A");
  assert.equal(matches[0].teams[0], "1A");
});

test("team edits allow name-only changes and reject duplicate or invalid identities", () => {
  assert.equal(editTeam(teams, [], "1A", "1A", "New name").teams[0].name, "New name");
  for (const [originalId, id, name] of [["1A", "2A", "Duplicate"], ["1A", "bad id", "Name"], ["1A", "9Z", " "], ["missing", "9Z", "Name"]]) {
    assert.throws(() => editTeam(teams, [], originalId, id, name));
  }
});

test("colored goal counts retain official point weights and a shared 38-bag limit", () => {
  const goals = { blue: [1, 2, 3, 4], red: [4, 3, 2, 1], unassigned: [0, 0, 0, 0], top: 6 };
  assert.deepEqual(goalCounts(goals), [5, 5, 5, 5, 6]);
  assert.equal(score(goalCounts(goals)), 206);
  assert.equal(score(goalCounts({ blue: [0, 0, 0, 16], red: [0, 0, 0, 16], unassigned: [0, 0, 0, 0], top: 6 })), 480);
  assert.throws(() => goalCounts({ ...goals, top: 19 }));
  assert.throws(() => goalCounts({ ...goals, blue: [0, -1, 0, 0] }));
  assert.throws(() => goalCounts({ ...goals, red: [0, 0.5, 0, 0] }));
});

test("older aggregate results retain their score without inventing goal colors", () => {
  const counts = [2, 3, 4, 5, 6];
  const goals = goalsFromCounts(counts);
  assert.deepEqual(goals.blue, [0, 0, 0, 0]);
  assert.deepEqual(goals.red, [0, 0, 0, 0]);
  assert.deepEqual(goals.unassigned, [2, 3, 4, 5]);
  assert.deepEqual(goalCounts(goals), counts);
  assert.equal(score(goalCounts(goals)), score(counts));
  assert.throws(() => goalCounts({ top: 0 }));
});

const skillsEntry = (team, mode, attempt, counts, stopTime = 0) => ({ team, mode, attempt, counts, stopTime, optIn: stopTime > 0, status: "ok" });

test("skills has three separate attempt slots per mode, with editable posted results", () => {
  let attempts = [];
  for (const mode of ["driver", "autonomous"]) for (let attempt = 1; attempt <= 3; attempt++) attempts = saveSkillAttempt(teams, attempts, skillsEntry("1A", mode, attempt, [attempt, 0, 0, 0, 0]));
  assert.equal(attempts.length, 6);
  attempts = saveSkillAttempt(teams, attempts, skillsEntry("1A", "driver", 2, [9, 0, 0, 0, 0]));
  assert.equal(attempts.length, 6);
  assert.equal(attempts.find(entry => entry.mode === "driver" && entry.attempt === 2).counts[0], 9);
  assert.throws(() => saveSkillAttempt(teams, attempts, skillsEntry("1A", "driver", 4, [0, 0, 0, 0, 0])));
  assert.throws(() => validateSkills(teams, [attempts[0], attempts[0]]));
  assert.throws(() => validateSkills(teams, [skillsEntry("missing", "driver", 1, [0, 0, 0, 0, 0])]));
});

test("T17 combines best scores, not averages, and prioritizes autonomous before stop time", () => {
  const attempts = [skillsEntry("1A", "driver", 1, [0, 0, 0, 0, 3]), skillsEntry("1A", "autonomous", 1, [0, 0, 0, 1, 0]), skillsEntry("2A", "driver", 1, [0, 0, 0, 1, 0], 40), skillsEntry("2A", "autonomous", 1, [0, 0, 0, 0, 3], 40)];
  const rows = skillsStandings(teams.slice(0, 2), attempts);
  assert.equal(rows[0].id, "2A");
  assert.equal(rows[0].total, 60);
  assert.equal(rows[1].total, 60);
});

test("T17 uses second scores, best-run stop times, then third scores", () => {
  const roster = teams.slice(0, 2);
  let attempts = roster.flatMap(team => [skillsEntry(team.id, "autonomous", 1, [20, 0, 0, 0, 0], 10), skillsEntry(team.id, "driver", 1, [20, 0, 0, 0, 0], 10)]);
  attempts.push(skillsEntry("2A", "autonomous", 2, [1, 0, 0, 0, 0]));
  assert.equal(skillsStandings(roster, attempts)[0].id, "2A");
  attempts.push(skillsEntry("1A", "autonomous", 2, [1, 0, 0, 0, 0], 59));
  assert.equal(skillsStandings(roster, attempts)[0].rank, 1);
  assert.equal(skillsStandings(roster, attempts)[1].rank, 1);
  attempts[0].stopTime = 11;
  assert.equal(skillsStandings(roster, attempts)[0].id, "1A");
  attempts[0].stopTime = 10;
  attempts.push(skillsEntry("2A", "autonomous", 3, [1, 0, 0, 0, 0]));
  assert.equal(skillsStandings(roster, attempts)[0].id, "2A");
});

test("T17 final goal-level tiebreakers prefer L4 and exact ties share rank", () => {
  const attempts = [skillsEntry("1A", "autonomous", 1, [0, 0, 0, 4, 0]), skillsEntry("2A", "autonomous", 1, [0, 0, 0, 0, 3])];
  assert.equal(skillsStandings(teams.slice(0, 2), attempts)[0].id, "2A");
  attempts[0].counts = [0, 0, 0, 0, 3];
  assert.deepEqual(skillsStandings(teams.slice(0, 2), attempts).map(row => row.rank), [1, 1]);
  assert.deepEqual(skillsStandings(teams.slice(0, 2), attempts, ["1A"]).map(row => row.rank), [1, null]);
});

test("DQ and forfeited skills attempts consume a slot but contribute no points or stop time", () => {
  const entry = { ...skillsEntry("1A", "autonomous", 1, [0, 0, 0, 0, 3]), status: "dq" };
  assert.equal(skillsStandings(teams, [entry])[0].total, 0);
  assert.equal(skillsStandings(teams, [entry])[0].modes.autonomous.length, 1);
  assert.throws(() => validateSkills(teams, [{ ...entry, stopTime: 10, optIn: true }]));
  assert.throws(() => validateSkills(teams, [{ ...entry, status: "ok", stopTime: 1 }]));
  assert.throws(() => validateSkills(teams, [{ ...entry, stopTime: 61, optIn: true }]));
});

test("T17 second driver precedes stop times, then autonomous stop breaks equal sums", () => {
  const roster = teams.slice(0, 2);
  const attempts = [skillsEntry("1A", "driver", 1, [20, 0, 0, 0, 0], 5), skillsEntry("1A", "autonomous", 1, [20, 0, 0, 0, 0], 15), skillsEntry("2A", "driver", 1, [20, 0, 0, 0, 0], 30), skillsEntry("2A", "autonomous", 1, [20, 0, 0, 0, 0], 30), skillsEntry("1A", "driver", 2, [5, 0, 0, 0, 0]), skillsEntry("2A", "driver", 2, [4, 0, 0, 0, 0])];
  assert.equal(skillsStandings(roster, attempts)[0].id, "1A");
  attempts[5].counts[0] = 5;
  attempts[2].stopTime = 15;
  attempts[3].stopTime = 5;
  assert.equal(skillsStandings(roster, attempts)[0].id, "1A");
});

test("T17 uses driver goal points after autonomous goal points remain tied", () => {
  const attempts = [skillsEntry("1A", "driver", 1, [0, 0, 4, 0, 0]), skillsEntry("2A", "driver", 1, [0, 0, 0, 2, 0])];
  assert.equal(skillsStandings(teams.slice(0, 2), attempts)[0].id, "2A");
  assert.ok(skillsStandings(teams, []).every(row => row.rank === null));
});

test("equal averages and equal draws fall back to team number instead of roster order", () => {
  const roster = [{ id: "10A", name: "Ten", draw: 7 }, { id: "2A", name: "Two", draw: 7 }];
  const matches = [{ id: 1, teams: ["10A", "2A"], surrogate: null, result: { counts: [5, 0, 0, 0, 0], statuses: { "10A": "ok", "2A": "ok" } } }];
  assert.deepEqual(standings(roster, matches).map(row => row.id), ["2A", "10A"]);
  assert.deepEqual(standings([...roster].reverse(), matches).map(row => row.id), ["2A", "10A"]);
  assert.deepEqual(standings(roster, []).map(row => row.id), ["2A", "10A"]);
});
