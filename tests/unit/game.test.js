"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Game = require("../../game.js");
const Core = require("../../event-rules.js");
const History = require("../../history.js");
const Rubric = require("../../rubric.js");
const EventModel = require("../../event.js");

const teams = [
  { id: "1A", name: "One", draw: 0 },
  { id: "2A", name: "Two", draw: 1 },
];
// A stand-in for a past season, registered the way a retired game definition stays loaded.
const previous = Game.register({
  ...Game.active,
  id: "previous-season",
  name: "Previous Game",
  season: "2025-2026",
});
const event = (extra = {}) => ({
  version: 1,
  name: "Event",
  teams,
  matches: [],
  skills: [],
  rounds: 6,
  start: "09:00",
  interval: 3,
  selected: null,
  history: [],
  ...extra,
});

test("the active game flag resolves to a complete registered definition", () => {
  assert.equal(Game.ACTIVE_GAME_ID, "level-up");
  assert.equal(Game.active, Game.get("level-up"));
  assert.ok(Game.ids().includes(Game.ACTIVE_GAME_ID));
  assert.throws(() => Game.register({ ...Game.active }), /already registered/);
  assert.throws(() => Game.register({ id: "incomplete" }), /missing/);
  assert.throws(() => Game.get("not-a-game"), /Unknown game/);
  assert.equal(Game.of({}), Game.LEGACY_GAME_ID);
  assert.equal(Game.of({ game: "level-up" }), "level-up");
  assert.deepEqual(Core.TIMING, { matchMs: 60000, driverSwitch: { openMs: 35000, closeMs: 25000 } });
  assert.ok(Game.label(Game.active).includes(Game.active.name));
});

test("V5 practice scoring follows Robot Skills and Teamwork point values", () => {
  const game = Game.get("override");
  assert.equal(game.practiceOnly, true);
  assert.deepEqual(game.practice.modes, ["teamwork", "driver", "autonomous"]);
  assert.equal(game.practice.scrimmage, true);
  assert.equal(game.practice.field.quadrants.length, 4);
  for (const key of [
    "practiceModes",
    "practiceQuadrants",
    "emptyPracticeGoals",
    "validatePracticeGoals",
    "practiceTeamworkScores",
    "practiceSkillsScore",
  ])
    assert.equal(Object.hasOwn(game, key), false);
  assert.deepEqual(game.practice.field.evaluate("teamwork", game.practice.field.empty()).kind, "scrimmage");
  assert.deepEqual(game.practice.field.evaluate("driver", game.practice.field.empty()).kind, "skills");
  assert.equal(Object.hasOwn(game, "timing"), false);
  assert.deepEqual(Game.timingFor(game), {
    matchMs: 60000,
    driverSwitch: null,
    teamworkPracticeMs: 120000,
    autonomousPeriodMs: 15000,
    driverPeriodMs: 105000,
  });
  assert.deepEqual(Game.timingFor({ program: "VEX V5" }), Game.timingFor(game));
  assert.equal(game.score([2, 3, 2, 1]), 68);
  assert.deepEqual(
    game.goalCounts({ alliance: 2, yellow: 3, midfield: 2, autonomousBonus: 1 }),
    [2, 3, 2, 1],
  );
  assert.deepEqual(
    game.goalCounts({ alliance: 2, yellow: 3, midfield: 1, autonomousBonus: 0 }),
    [2, 3, 1, 0],
  );
  assert.throws(() => game.score([0, 0, 3, 0]), /Midfield/);
  assert.throws(() => game.score([0, 0, 0, 2]), /Autonomous Bonus/);
});

test("V5 configures Ohio Middle and High School standings without a snapshot", () => {
  const config = Game.get("override").officialStandings;
  assert.equal(config.apiUrl, "https://events.vex.com/api/seasons/204/skills?post_season=0");
  assert.deepEqual(config.groups, [
    { gradeLevel: "Middle School", teamPrefix: "4810" },
    { gradeLevel: "High School", teamPrefix: "6008" },
  ]);
  assert.equal(Object.hasOwn(config, "capturedAt"), false);
  assert.equal(Object.hasOwn(config, "teams"), false);
});

test("IQ configures Ohio Elementary and Middle School standings", () => {
  const game = Game.get("level-up");
  assert.equal(game.teamProfileProgram, "VIQRC");
  assert.equal(game.officialStandings.apiUrl, "https://events.vex.com/api/seasons/203/skills?post_season=0");
  assert.deepEqual(game.officialStandings.groups, [
    { gradeLevel: "Elementary", teamPrefix: "28101" },
    { gradeLevel: "Middle School", teamPrefix: "28102" },
  ]);
  assert.equal(Object.hasOwn(game.officialStandings, "capturedAt"), false);
  assert.equal(Object.hasOwn(game.officialStandings, "teams"), false);
});

test("event validation drops retired official team detail snapshots", () => {
  const candidate = {
    ...event(),
    game: "override",
    officialTeamData: [{ team: "1A", rankings: [], matches: [], awards: [] }],
  };
  const validated = EventModel.validate(candidate);
  assert.equal(Object.hasOwn(validated, "officialTeamData"), false);
});

test("V5 practice field-state scoring honors quadrant Toggles and Midfield ownership", () => {
  const game = Game.get("override");
  const field = game.practice.field;
  const goals = field.empty();
  goals.quadrants[0].red = 2;
  goals.quadrants[0].yellow = 1;
  goals.quadrants[0].toggle = "red";
  goals.quadrants[1].blue = 3;
  goals.quadrants[1].yellow = 2;
  goals.quadrants[1].toggle = "blue";
  goals.midfield.red = 1;
  goals.midfield.blue = 2;
  goals.midfield.yellow = 1;
  goals.midfield.redRobots = 1;
  goals.midfield.blueRobots = 2;
  goals.autonomousBonus.red = true;
  const scores = field.evaluate("teamwork", goals).scores;
  assert.equal(scores.red.score, 45);
  assert.equal(scores.blue.score, 71);
  const sharedBonusGoals = structuredClone(goals);
  sharedBonusGoals.autonomousBonus.blue = true;
  const sharedBonus = field.evaluate("teamwork", sharedBonusGoals).scores;
  assert.equal(sharedBonus.red.score, 39);
  assert.equal(sharedBonus.blue.score, 77);
  const skillsGoals = structuredClone(goals);
  skillsGoals.midfield.blueRobots = 0;
  assert.equal(field.evaluate("driver", skillsGoals).score, 88);
  const skillsRedToggle = structuredClone(skillsGoals);
  skillsRedToggle.quadrants[1].toggle = "red";
  assert.equal(field.evaluate("driver", skillsRedToggle).score, 68);
  goals.quadrants[0].toggle = "blue";
  const transferred = field.evaluate("teamwork", goals).scores;
  assert.equal(transferred.red.score, 35);
  assert.equal(transferred.blue.score, 81);
  const skillsTransfer = structuredClone(skillsGoals);
  skillsTransfer.quadrants[0].toggle = "blue";
  assert.equal(field.evaluate("driver", skillsTransfer).score, 78);
});

test("V5 Teamwork colored pins follow pin color everywhere while Skills pins follow quadrant sections", () => {
  const game = Game.get("override");
  const field = game.practice.field;
  const goals = field.empty();
  goals.quadrants[0].blue = 2;
  goals.quadrants[0].toggle = "blue";
  goals.quadrants[1].red = 1;
  goals.quadrants[1].toggle = "red";

  const scores = field.evaluate("teamwork", goals).scores;
  assert.equal(scores.red.score, 5);
  assert.equal(scores.blue.score, 10);
  assert.equal(field.evaluate("driver", goals).score, 0);
  goals.quadrants[0].red = 1;
  goals.quadrants[1].blue = 2;
  const matchingPins = field.evaluate("teamwork", goals).scores;
  assert.equal(matchingPins.red.score, 10);
  assert.equal(matchingPins.blue.score, 20);
  assert.equal(field.evaluate("driver", goals).score, 15);
});

test("every scoring layout input maps to a goal path and a scoring element", () => {
  const game = Game.active;
  const goals = game.emptyGoals();
  const paths = game.layout.flatMap((group) => group.inputs.map((input) => input.path.join(".")));
  assert.equal(new Set(paths).size, paths.length);
  for (const group of game.layout) {
    for (const input of group.inputs) {
      const value = input.path.reduce((node, key) => node[key], goals);
      assert.equal(value, 0, input.path.join("."));
      assert.ok(game.scoring.elements[input.element], input.path.join("."));
      const filled = game.emptyGoals();
      input.path.slice(0, -1).reduce((node, key) => node[key], filled)[input.path[input.path.length - 1]] = 2;
      assert.equal(
        Core.score(game.goalCounts(filled)),
        2 * game.scoring.elements[input.element].points,
        input.path.join("."),
      );
    }
  }
  assert.deepEqual(
    Core.emptyCounts(),
    game.scoring.elements.map(() => 0),
  );
});

test("events without a game load as the legacy game and unknown games are rejected", () => {
  assert.equal(EventModel.validate(event()).game, Game.LEGACY_GAME_ID);
  assert.throws(() => EventModel.validate(event({ game: "future-game" })), /game/i);
});

test("rollover starts the new season with no teams but keeps score history", () => {
  const current = EventModel.validate(event());
  assert.equal(EventModel.rollover(current), current);
  const old = {
    ...current,
    game: previous.id,
    matches: [{ id: 1 }],
    skills: [{ team: "1A" }],
    selected: 1,
    robots: [{ id: "r1", team: "1A" }],
    skillsOnly: true,
  };
  const next = EventModel.rollover(old);
  assert.equal(next.game, Game.ACTIVE_GAME_ID);
  assert.notEqual(next.sessionId, old.sessionId);
  assert.deepEqual([next.matches, next.finals, next.skills, next.selected], [[], [], [], null]);
  assert.deepEqual([next.teams, next.robots, next.skillsOnly], [[], [], false]);
  assert.equal(next.history, old.history);
  assert.equal(next.rubrics, old.rubrics);
  assert.doesNotThrow(() => EventModel.validate(JSON.parse(JSON.stringify(next))));
  assert.throws(() => EventModel.rollover(current, "not-a-game"), /Unknown game/);
});

test("score history is tagged with its game and exports only the requested game", () => {
  const input = {
    mode: "teamwork",
    teams: ["1A", "2A"],
    goals: Core.goalsFromCounts([5, 0, 0, 0, 0]),
    occurredAt: "2026-10-20T10:00:00Z",
    notes: "",
    statuses: { "1A": "ok", "2A": "ok" },
  };
  const record = History.practiceRecord([], teams, input);
  assert.equal(record.game, Game.ACTIVE_GAME_ID);
  const archived = { ...History.practiceRecord([], teams, input), game: "previous-season" };
  assert.deepEqual(History.forGame([record, archived]), [record]);
  const [header, ...rows] = History.csv([record, archived]).split("\r\n").filter(Boolean);
  assert.match(header, /(^|,)"?Game"?(,|$)/);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.includes(Game.active.name) && !row.includes("Previous Game")));
  assert.throws(() => History.validate([{ ...record, game: "future-game" }], teams), /unknown game/);
});

test("rubric review histories are kept per game for the same team", () => {
  const input = {
    evaluatedOn: "2026-10-29",
    reviewer: "Coach",
    overallNotes: "",
    scores: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, 3])),
    notes: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, ""])),
  };
  const earlier = { ...Rubric.save([], teams[0], input)[0], game: "previous-season" };
  const saved = Rubric.save([earlier], teams[0], input);
  assert.equal(saved.length, 2);
  assert.deepEqual(
    Game.forGame(saved).map((entry) => entry.game),
    [Game.ACTIVE_GAME_ID],
  );
  assert.equal(Game.forGame(Rubric.save(saved, teams[0], input)).length, 2);
});

test("skills tiebreaks come from the game definition", () => {
  assert.deepEqual(Game.active.skillsTiebreak([0, 0, 1, 1, 1]), [16, 12, 6]);
});
