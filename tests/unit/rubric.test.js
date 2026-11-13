"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Rubric = require("../../rubric.js");
const EventModel = require("../../event.js");
const team = { id: "1A", name: "One", draw: 0 };
const input = (score = null) => ({
  evaluatedOn: "2026-10-29", reviewer: "Coach", overallNotes: "Next steps",
  scores: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, score])),
  notes: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, ""]))
});
const saved = score => Rubric.save([], team, input(score))[0];
const event = () => ({ version: 1, name: "Event", teams: [team], matches: [], skills: [], rounds: 6, start: "09:00", interval: 3, selected: null });

test("student reviews stay in history and exports but never change coach scores or cumulative ranking", () => {
  for (const rubric of [Rubric, Rubric.Interview]) {
    const draft = score => ({
      evaluatedOn: "2026-11-02", reviewer: "Student", overallNotes: "Peer feedback",
      scores: Object.fromEntries(rubric.criteria.map(({ id }) => [id, score])),
      notes: Object.fromEntries(rubric.criteria.map(({ id }) => [id, ""]))
    });
    const student = { ...draft(rubric.maximum), reviewRole: "member", authorEmail: "student@nu-district.org" };
    const peerOnly = rubric.save([], team, student);
    assert.equal(rubric.current(peerOnly, team.id), null);
    const coach = rubric.save([], team, { ...draft(rubric.minimum), evaluatedOn: "2026-10-01" });
    // Missing metadata in old backups continues to mean coach review.
    delete coach[0].reviewRole;
    delete coach[0].authorEmail;
    const mixed = rubric.save(coach, team, student);
    assert.deepEqual(rubric.current(mixed, team.id), rubric.current(coach, team.id));
    const args = list => rubric === Rubric ? [[], [team], list, []] : [[], [team], [], list];
    assert.deepEqual(Rubric.combinedRanking(...args(mixed)), Rubric.combinedRanking(...args(coach)));
    assert.equal(Rubric.combinedRanking(...args(peerOnly))[0][rubric === Rubric ? "notebook" : "interview"], 0);
    assert.equal(rubric.reviews(mixed, team.id).length, 2);
    assert.match(rubric.csv(mixed), /"member","student@nu-district.org"/);
    const edited = rubric.save(mixed, team, { ...draft(rubric.minimum), reviewRole: "coach", authorEmail: "coach@nu-district.org" }, mixed[1].id);
    assert.equal(edited[1].reviewRole, "member");
    assert.equal(edited[1].authorEmail, student.authorEmail);
    assert.throws(() => rubric.validate([{ ...mixed[1], reviewRole: "other" }]), /review role/);
  }
});

test("v2 rubric has sixteen 1-4 criteria with the exact five section maxima and 64 total", () => {
  assert.equal(Rubric.version, "v2.0");
  assert.equal(Rubric.criteria.length, 16);
  assert.equal(new Set(Rubric.criteria.map(item => item.id)).size, 16);
  const sections = [...new Set(Rubric.criteria.map(item => item.section))];
  assert.deepEqual(sections.map(section => Rubric.criteria.filter(item => item.section === section).length * 4), [16, 12, 16, 12, 8]);
  assert.deepEqual(Rubric.summary(saved(4)), { total: 64, scored: 16, maximum: 64 });
  assert.deepEqual(Rubric.summary(saved(1)), { total: 16, scored: 16, maximum: 64 });
});

test("blank ratings remain unassessed, distinct from invalid zero scores", () => {
  const evaluation = saved(null);
  evaluation.scores.navigation = 3;
  assert.deepEqual(Rubric.summary(evaluation), { total: 3, scored: 1, maximum: 64 });
  for (const score of [0, 5, -1, 1.5, "3", undefined, NaN]) {
    const invalid = structuredClone(evaluation);
    invalid.scores.navigation = score;
    assert.throws(() => Rubric.validate([invalid]), /whole numbers/);
    const draft = input();
    draft.scores.navigation = score;
    assert.throws(() => Rubric.save([], team, draft), /whole numbers/);
  }
});

test("each save adds a review to the team's history; edits keep the review and copy inputs", () => {
  const first = saved(2);
  const other = Rubric.save([], { id: "2A", name: "Two" }, input(3))[0];
  const draft = { ...input(4), evaluatedOn: "2026-11-05" };
  draft.notes.code = "Add a flowchart";
  const evaluations = Rubric.save([first, other], team, draft);
  draft.notes.code = "Changed later";
  assert.equal(evaluations.length, 3);
  assert.deepEqual(evaluations.slice(0, 2), [first, other]);
  const reviews = Rubric.reviews(evaluations, "1A");
  assert.deepEqual(reviews.map(entry => entry.evaluatedOn), ["2026-10-29", "2026-11-05"]);
  assert.notEqual(reviews[0].id, reviews[1].id);
  assert.equal(reviews[1].notes.code, "Add a flowchart");
  assert.equal(first.scores.code, 2);
  const edited = Rubric.save(evaluations, team, { ...input(1), reviewer: "Edited" }, first.id);
  assert.equal(edited.length, 3);
  const changed = edited.find(entry => entry.id === first.id);
  assert.equal(changed.reviewer, "Edited");
  assert.equal(changed.createdAt, first.createdAt);
  assert.equal(Rubric.summary(changed).total, 16);
  assert.throws(() => Rubric.save(evaluations, team, input(1), "missing"), /no longer exists/);
  const blank = input(null);
  blank.overallNotes = " ";
  assert.throws(() => Rubric.save([], team, blank), /at least one criterion/);
});

test("the current result takes each criterion's latest score, so targeted follow-up reviews update only those criteria", () => {
  const full = Rubric.save([], team, input(2));
  const followUp = input(null);
  followUp.evaluatedOn = "2026-11-05";
  followUp.scores.code = 4;
  followUp.scores.navigation = 3;
  followUp.notes.code = "Much clearer";
  const history = Rubric.save(full, team, followUp);
  const result = Rubric.current(history, "1A");
  assert.equal(result.reviews, 2);
  assert.equal(result.scored, 16);
  assert.equal(result.total, 2 * 14 + 4 + 3);
  assert.deepEqual(result.criteria.code, { score: 4, scoredOn: "2026-11-05", note: "Much clearer", notedOn: "2026-11-05" });
  assert.equal(result.criteria.season.scoredOn, "2026-10-29");
  assert.equal(result.latest.evaluatedOn, "2026-11-05");
  const backdated = Rubric.save(history, team, { ...input(null), evaluatedOn: "2026-10-01", scores: { ...input(null).scores, code: 1 } });
  assert.equal(Rubric.current(backdated, "1A").criteria.code.score, 4);
  const followUpId = Rubric.reviews(history, "1A")[1].id;
  assert.equal(Rubric.current(history, "1A", followUpId).criteria.code.score, 2);
  assert.equal(Rubric.current(Rubric.remove(history, followUpId), "1A").total, 32);
  assert.throws(() => Rubric.remove(history, "missing"), /no longer exists/);
  assert.equal(Rubric.current(history, "2A"), null);
});

test("reviews saved before review history get a stable legacy ID", () => {
  const legacy = saved(3);
  delete legacy.id;
  delete legacy.createdAt;
  const [migrated] = Rubric.validate([structuredClone(legacy)]);
  assert.equal(migrated.id, `legacy:${legacy.game}|1A`);
  assert.equal(migrated.createdAt, legacy.updatedAt);
  assert.deepEqual(Rubric.merge([structuredClone(legacy)], [structuredClone(legacy)]).length, 1);
  assert.equal(Rubric.save([structuredClone(legacy)], team, input(4)).length, 2);
});

test("rubric validation rejects malformed metadata, missing criteria, and oversized notes", () => {
  for (const mutate of [
    entry => { entry.version = "v1.0"; },
    entry => { entry.evaluatedOn = "2026-02-30"; },
    entry => { entry.evaluatedOn = "invalid"; },
    entry => { entry.updatedAt = "invalid"; },
    entry => { entry.team.id = "<script>"; },
    entry => { entry.reviewer = "x".repeat(81); },
    entry => { entry.notes.code = "x".repeat(2001); },
    entry => { entry.overallNotes = "x".repeat(4001); },
    entry => { delete entry.scores.code; },
    entry => { entry.notes.extra = ""; }
  ]) {
    const entry = saved(3);
    mutate(entry);
    assert.throws(() => Rubric.validate([entry]));
  }
  const entry = saved(3);
  assert.equal(Rubric.validate([entry, saved(4)]).length, 2);
  assert.throws(() => Rubric.validate([entry, { ...saved(4), id: entry.id }]), /duplicate/);
  assert.throws(() => Rubric.validate([{ ...entry, id: "" }]), /review/);
});

test("team edits move every review, preserve evidence, and combine histories on renumbering", () => {
  const original = saved(3);
  const second = Rubric.save([original], team, { ...input(4), evaluatedOn: "2026-11-05" });
  const evaluations = Rubric.rename(second, "1A", { id: "9Z", name: "Renamed" });
  assert.deepEqual(evaluations.map(entry => entry.team.id), ["9Z", "9Z"]);
  assert.equal(evaluations[0].team.name, "Renamed");
  assert.deepEqual(evaluations[0].scores, original.scores);
  assert.equal(original.team.id, "1A");
  const existing = Rubric.save([], { id: "9Z", name: "Existing" }, input(1));
  assert.equal(Rubric.reviews(Rubric.rename([...existing, original], "1A", { id: "9Z", name: "Renamed" }), "9Z").length, 2);
});

test("backups merge reviews by ID, keep the latest edit of each review and detect equal-time conflicts", () => {
  const older = { ...saved(2), updatedAt: "2026-10-28T10:00:00Z" };
  const newer = { ...older, scores: saved(4).scores, updatedAt: "2026-10-29T10:00:00Z" };
  const another = saved(3);
  assert.deepEqual(Rubric.merge([older], [another]), [older, another]);
  assert.deepEqual(Rubric.merge([newer], [older]), [newer]);
  assert.deepEqual(Rubric.merge([older], [newer]), [newer]);
  assert.deepEqual(Rubric.merge([newer], [structuredClone(newer)]), [newer]);
  assert.deepEqual(Rubric.merge([newer], []), [newer]);
  assert.throws(() => Rubric.merge([newer], [{ ...older, updatedAt: newer.updatedAt }]), /Conflicting/);
});

test("event validation migrates old backups, retains removed-team rubrics and validates new backups", () => {
  const legacy = EventModel.validate(event());
  assert.deepEqual(legacy.rubrics, []);
  const current = EventModel.validate({ ...event(), rubrics: [saved(3)] });
  const before = JSON.stringify({ matches: current.matches, skills: current.skills, history: current.history });
  const restored = EventModel.validate(JSON.parse(JSON.stringify(current)));
  assert.deepEqual(restored.rubrics, current.rubrics);
  assert.equal(JSON.stringify({ matches: restored.matches, skills: restored.skills, history: restored.history }), before);
  restored.teams = [];
  assert.equal(EventModel.validate(restored).rubrics.length, 1);
  assert.throws(() => EventModel.validate({ ...event(), rubrics: null }), /notebook evaluations/);
});

test("rubric CSV includes criterion feedback, completion counts and formula-safe cells", () => {
  const evaluation = saved(null);
  evaluation.reviewer = "=FORMULA()";
  evaluation.notes.code = 'Evidence, "quoted"\nNext line';
  evaluation.scores.code = 4;
  const csv = Rubric.csv([evaluation]);
  assert.ok(csv.includes('"Rubric version","Total","Criteria scored"'));
  assert.ok(csv.includes('"Code is documented","Code is documented notes"'));
  assert.ok(csv.includes(`"'=FORMULA()"`));
  assert.ok(csv.includes('"v2.0","4","1"'));
  assert.ok(csv.includes('"Team","Team name","Review number","Evaluation date"'));
  const later = Rubric.save([], team, { ...input(2), evaluatedOn: "2026-11-05" })[0];
  const rows = Rubric.csv([later, evaluation]).split(/\r?\n(?=")/);
  assert.ok(rows[1].startsWith('"1A","One","1","2026-10-29"'));
  assert.ok(rows[2].startsWith('"1A","One","2","2026-11-05"'));
  assert.ok(csv.includes('"Evidence, ""quoted""\nNext line"'));
});

const Interview = Rubric.Interview;
test("coaching guidance covers every notebook and interview criterion at every rating", () => {
  const guidance = require("../../rubric-guidance.js");
  for (const [label, model] of [["notebook", Rubric], ["interview", Interview]]) {
    assert.deepEqual(Object.keys(guidance[label]).sort(), model.criteria.map(item => item.id).sort());
    for (const { id } of model.criteria) {
      assert.equal(guidance[label][id].length, model.maximum - model.minimum + 1);
      assert.ok(guidance[label][id].every(description => typeof description === "string" && description.trim().length > 20 || Array.isArray(description) && description.length > 0 && description.every(point => typeof point === "string" && point.trim().length > 0) || description && typeof description === "object" && typeof description.text === "string" && description.text.trim().length > 0 && Array.isArray(description.bullets) && description.bullets.length > 0 && description.bullets.every(point => typeof point === "string" && point.trim().length > 0)));
    }
  }
});
const interviewInput = score => ({
  evaluatedOn: "2026-10-29", reviewer: "Coach", overallNotes: "Interview feedback",
  scores: Object.fromEntries(Interview.criteria.map(({ id }) => [id, score])),
  notes: Object.fromEntries(Interview.criteria.map(({ id }) => [id, "Evidence"]))
});

test("interview v2 has six 0-2 criteria, two sections of six points and a maximum of twelve", () => {
  assert.equal(Interview.version, "v2.0");
  assert.equal(Interview.criteria.length, 6);
  assert.deepEqual([...new Set(Interview.criteria.map(item => item.section))].map(section => Interview.criteria.filter(item => item.section === section).length * Interview.maximum), [6, 6]);
  assert.deepEqual(Interview.summary(Interview.save([], team, interviewInput(2))[0]), { total: 12, scored: 6, maximum: 12 });
  assert.deepEqual(Interview.summary(Interview.save([], team, interviewInput(0))[0]), { total: 0, scored: 6, maximum: 12 });
  assert.deepEqual(Interview.summary(Interview.save([], team, interviewInput(null))[0]), { total: 0, scored: 0, maximum: 12 });
  for (const value of [-1, 3, 0.5, "1", NaN, undefined]) assert.throws(() => Interview.save([], team, interviewInput(value)), /whole numbers/);
});

test("interview saves add reviews per team without affecting notebook evaluations", () => {
  const first = Interview.save([], team, interviewInput(1));
  const secondTeam = { id: "2A", name: "Two" };
  const both = Interview.save(first, secondTeam, interviewInput(0));
  const updated = Interview.save(both, team, { ...interviewInput(2), evaluatedOn: "2026-11-05" });
  assert.equal(updated.length, 3);
  assert.equal(Interview.current(updated, "2A").criteria.evidence.score, 0);
  assert.equal(Interview.current(updated, "1A").criteria.evidence.score, 2);
  assert.equal(Interview.reviews(updated, "1A")[0].scores.evidence, 1);
  assert.equal(first[0].scores.evidence, 1);
  assert.throws(() => Rubric.validate(updated));
  assert.throws(() => Interview.validate([saved(3)]));
});

test("interview backup merging, team renumbering and validation retain criterion evidence", () => {
  const older = { ...Interview.save([], team, interviewInput(1))[0], updatedAt: "2026-10-28T10:00:00Z" };
  const newer = { ...older, scores: Interview.save([], team, interviewInput(2))[0].scores, updatedAt: "2026-10-29T10:00:00Z" };
  assert.deepEqual(Interview.merge([newer], [older]), [newer]);
  assert.deepEqual(Interview.merge([older], [newer]), [newer]);
  assert.throws(() => Interview.merge([newer], [{ ...older, updatedAt: newer.updatedAt }]), /Conflicting interview/);
  const renamed = Interview.rename([newer], "1A", { id: "9Z", name: "Renamed" });
  assert.equal(renamed[0].team.id, "9Z");
  assert.equal(renamed[0].notes.evidence, "Evidence");
  const invalid = structuredClone(newer);
  invalid.notes.evidence = "x".repeat(2001);
  assert.throws(() => Interview.validate([invalid]), /2000/);
  delete invalid.notes.evidence;
  assert.throws(() => Interview.validate([invalid]), /criteria/);
});

test("event snapshots migrate missing interviews and round trip notebook and interview separately", () => {
  assert.deepEqual(EventModel.validate(event()).interviews, []);
  const current = EventModel.validate({ ...event(), rubrics: [saved(4)], interviews: Interview.save([], team, interviewInput(0)) });
  const restored = EventModel.validate(JSON.parse(JSON.stringify(current)));
  assert.equal(restored.rubrics[0].scores.code, 4);
  assert.equal(restored.interviews[0].scores.evidence, 0);
  restored.teams = [];
  assert.equal(EventModel.validate(restored).interviews.length, 1);
  assert.throws(() => EventModel.validate({ ...event(), interviews: null }), /interview evaluations/);
});

test("interview CSV distinguishes assessed zeros from blanks and escapes feedback", () => {
  const evaluation = Interview.save([], team, interviewInput(null))[0];
  evaluation.scores["own-work"] = 0;
  evaluation.reviewer = "=FORMULA()";
  evaluation.notes.evidence = 'Counts, "times"';
  const csv = Interview.csv([evaluation]);
  assert.ok(csv.includes('"v2.0","0","1","0","Evidence","","Evidence"'));
  assert.ok(csv.includes(`"'=FORMULA()"`));
  assert.ok(csv.includes('"Counts, ""times"""'));
});

test("combined ranking weights leader-relative skills/teamwork and absolute rubrics exactly", () => {
  const History = require("../../history.js");
  const Core = require("../../event-rules.js");
  const teams = [team, { id: "2A", name: "Two" }, { id: "3A", name: "Three" }];
  const records = [];
  const run = (mode, ids, score) => {
    records.push(History.practiceRecord(records, teams, {
      mode, teams: ids, goals: Core.goalsFromCounts([score, 0, 0, 0, 0]), occurredAt: "2026-10-29T12:00:00Z", notes: "",
      status: "ok", optIn: false, stopTime: 0, statuses: Object.fromEntries(ids.map(id => [id, "ok"]))
    }));
  };
  run("driver", ["1A"], 10);
  run("autonomous", ["1A"], 10);
  run("driver", ["2A"], 10);
  run("teamwork", ["1A", "2A"], 20);
  const notebooks = Rubric.save([], team, input(4));
  const interviews = Interview.save([], team, interviewInput(2));
  const rows = Rubric.combinedRanking(records, teams, notebooks, interviews);
  const scaledPoints = (score, leader) => 25 * Math.log1p(score) / Math.log1p(leader);
  assert.equal(rows[0].total, 100);
  assert.deepEqual([rows[0].skillsPoints, rows[0].teamworkPoints, rows[0].notebookPoints, rows[0].interviewPoints], [25, 25, 40, 10]);
  assert.deepEqual(rows[0].missing, []);
  const followUp = interviewInput(null);
  followUp.evaluatedOn = "2026-11-05";
  followUp.scores.evidence = 0;
  const updated = Rubric.combinedRanking(records, teams, notebooks, Interview.save(interviews, team, followUp));
  assert.equal(updated[0].interviewPoints, 10 / 12 * 10);
  assert.deepEqual(updated[0].missing, []);
  assert.ok(Math.abs(rows[1].total - (scaledPoints(10, 20) + 25)) < 1e-10);
  assert.ok(rows[1].missing.includes("No Autonomous result"));
  assert.equal(rows[2].total, 0);
  assert.equal(rows[2].rank, 3);
  const eventsOnly = Rubric.combinedRanking(History.filterSource(records, "event"), teams, notebooks, interviews);
  assert.equal(eventsOnly[0].total, 50);
  assert.equal(eventsOnly[1].total, 0);
  assert.equal(eventsOnly[2].rank, eventsOnly[1].rank);
});

test("combined rankings use partial rubrics without rescaling and include rubric-only teams", () => {
  const notebook = input(null);
  notebook.scores.code = 4;
  const interviews = interviewInput(null);
  interviews.scores.evidence = 2;
  const rows = Rubric.combinedRanking([], [], Rubric.save([], team, notebook), Interview.save([], team, interviews));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].notebookPoints, 2.5);
  assert.equal(rows[0].interviewPoints, 2 / 12 * 10);
  assert.equal(rows[0].total, 2.5 + 2 / 12 * 10);
  assert.ok(rows[0].missing.includes("Notebook incomplete (1/16)"));
  assert.ok(rows[0].missing.includes("Interview incomplete (1/6)"));
  assert.ok(Number.isFinite(rows[0].total));
  assert.deepEqual(Rubric.combinedRanking([]), []);
});

test("combined ranking can place rubric strength above the skills leader and follows corrections", () => {
  const History = require("../../history.js");
  const Core = require("../../event-rules.js");
  const other = { id: "2A", name: "Two" };
  const teams = [team, other];
  const inputRun = {
    mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([20, 0, 0, 0, 0]),
    occurredAt: "2026-10-29T12:00:00Z", notes: "", status: "ok", optIn: false, stopTime: 0
  };
  const first = History.practiceRecord([], teams, inputRun);
  const second = History.practiceRecord([first], teams, { ...inputRun, teams: ["2A"], goals: Core.goalsFromCounts([10, 0, 0, 0, 0]) });
  const notebooks = Rubric.save([], other, input(4));
  let rows = Rubric.combinedRanking([first, second], teams, notebooks);
  assert.equal(rows[0].id, "2A");
  assert.ok(Math.abs(rows[0].total - (40 + 25 * Math.log1p(10) / Math.log1p(20))) < 1e-10);
  const corrected = History.practiceRecord([first, second], teams, { ...inputRun, goals: Core.goalsFromCounts([5, 0, 0, 0, 0]) }, first.runId);
  rows = Rubric.combinedRanking([first, second, corrected], teams, notebooks);
  assert.equal(rows[0].total, 65);
  assert.ok(Math.abs(rows[1].skillsPoints - 25 * Math.log1p(5) / Math.log1p(10)) < 1e-10);
  const removed = History.removePractice([first, second, corrected], second.runId);
  rows = Rubric.combinedRanking([first, second, corrected, removed], teams, notebooks);
  assert.equal(rows[0].id, "2A");
  assert.equal(rows[0].total, 40);
  assert.equal(rows[1].total, 25);
});
