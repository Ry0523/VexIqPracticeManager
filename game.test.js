"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Game = require("./game.js");
const Core = require("./core.js");
const History = require("./history.js");
const Rubric = require("./rubric.js");
const EventModel = require("./event.js");

const teams = [{ id: "1A", name: "One", draw: 0 }, { id: "2A", name: "Two", draw: 1 }];
// A stand-in for a past season, registered the way a retired game definition stays loaded.
const previous = Game.register({ ...Game.active, id: "previous-season", name: "Previous Game", season: "2025-2026" });
const event = (extra = {}) => ({ version: 1, name: "Event", teams, matches: [], skills: [], rounds: 6, start: "09:00", interval: 3, selected: null, history: [], ...extra });

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
  assert.match(Game.label(Game.active), /Level Up/);
});

test("every scoring layout input maps to a goal path and a scoring element", () => {
  const game = Game.active;
  const goals = game.emptyGoals();
  const paths = game.layout.flatMap(group => group.inputs.map(input => input.path.join(".")));
  assert.equal(new Set(paths).size, paths.length);
  for (const group of game.layout) {
    for (const input of group.inputs) {
      const value = input.path.reduce((node, key) => node[key], goals);
      assert.equal(value, 0, input.path.join("."));
      assert.ok(game.scoring.elements[input.element], input.path.join("."));
      const filled = game.emptyGoals();
      input.path.slice(0, -1).reduce((node, key) => node[key], filled)[input.path[input.path.length - 1]] = 2;
      assert.equal(Core.score(game.goalCounts(filled)), 2 * game.scoring.elements[input.element].points, input.path.join("."));
    }
  }
  assert.deepEqual(Core.emptyCounts(), game.scoring.elements.map(() => 0));
});

test("events without a game load as the legacy game and unknown games are rejected", () => {
  assert.equal(EventModel.validate(event()).game, Game.LEGACY_GAME_ID);
  assert.throws(() => EventModel.validate(event({ game: "future-game" })), /game/i);
});

test("rollover starts the new season with no teams but keeps score history", () => {
  const current = EventModel.validate(event());
  assert.equal(EventModel.rollover(current), current);
  const old = { ...current, game: previous.id, matches: [{ id: 1 }], skills: [{ team: "1A" }], selected: 1, robots: [{ id: "r1", team: "1A" }], skillsOnly: true };
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
  const input = { mode: "teamwork", teams: ["1A", "2A"], goals: Core.goalsFromCounts([5, 0, 0, 0, 0]), occurredAt: "2026-10-20T10:00:00Z", notes: "", statuses: { "1A": "ok", "2A": "ok" } };
  const record = History.practiceRecord([], teams, input);
  assert.equal(record.game, Game.ACTIVE_GAME_ID);
  const archived = { ...History.practiceRecord([], teams, input), game: "previous-season" };
  assert.deepEqual(History.forGame([record, archived]), [record]);
  const [header, ...rows] = History.csv([record, archived]).split("\r\n").filter(Boolean);
  assert.match(header, /(^|,)"?Game"?(,|$)/);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.includes("Level Up") && !row.includes("Previous Game")));
  assert.throws(() => History.validate([{ ...record, game: "future-game" }], teams), /unknown game/);
});

test("rubric review histories are kept per game for the same team", () => {
  const input = {
    evaluatedOn: "2026-10-29", reviewer: "Coach", overallNotes: "",
    scores: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, 3])),
    notes: Object.fromEntries(Rubric.criteria.map(({ id }) => [id, ""]))
  };
  const earlier = { ...Rubric.save([], teams[0], input)[0], game: "previous-season" };
  const saved = Rubric.save([earlier], teams[0], input);
  assert.equal(saved.length, 2);
  assert.deepEqual(Game.forGame(saved).map(entry => entry.game), [Game.ACTIVE_GAME_ID]);
  assert.equal(Game.forGame(Rubric.save(saved, teams[0], input)).length, 2);
});

test("skills tiebreaks come from the game definition", () => {
  assert.deepEqual(Game.active.skillsTiebreak([0, 0, 1, 1, 1]), [16, 12, 6]);
});
