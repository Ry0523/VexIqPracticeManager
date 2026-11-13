/** Registers game definitions and exposes active-game identity, timing, and lookup helpers. */
(function (root) {
  "use strict";
  // Season flag: set this to the id of the game definition in games/ that the app should run.
  // Events and evaluations saved under another game are archived when the app next loads.
  const ACTIVE_GAME_ID = "level-up";
  // Records saved before games were tracked belong to this game.
  const LEGACY_GAME_ID = "level-up";

  const definitions = typeof module !== "undefined" && module.exports
    ? Object.fromEntries([require("./games/level-up/definition.js"), require("./games/override/definition.js")].map(game => [game.id, game]))
    : root.VexGameDefinitions || {};

  const REQUIRED = ["id", "name", "program", "season", "manual", "scoring", "score", "emptyGoals", "goalCounts", "goalsFromCounts", "layout", "skillsTiebreak", "csv"];
  // Program-standard timing profiles; game definitions may still override IQ timing.
  const IQ_TIMING = Object.freeze({ matchMs: 60000, driverSwitch: { openMs: 35000, closeMs: 25000 } });
  const V5_TIMING = Object.freeze({ matchMs: 60000, driverSwitch: null, teamworkPracticeMs: 120000, autonomousPeriodMs: 15000, driverPeriodMs: 105000 });
  const check = game => {
    const missing = REQUIRED.filter(key => game[key] === undefined);
    if (missing.length) throw new Error(`Game definition ${game.id || "(unnamed)"} is missing: ${missing.join(", ")}.`);
    return game;
  };
  Object.values(definitions).forEach(check);

  /**
   * Add a complete definition; IDs are stable because saved records are tagged with them.
    * @param {import("./types").GameDefinition} game Definition satisfying the required game contract.
    * @returns {import("./types").GameDefinition} The registered definition.
   * @throws {Error} If the ID is duplicate or required fields are missing.
   */
  function register(game) {
    if (Object.prototype.hasOwnProperty.call(definitions, game.id)) throw new Error(`Game "${game.id}" is already registered.`);
    definitions[game.id] = check(game);
    return game;
  }

  /**
   * Resolve a game ID or fail explicitly rather than interpreting data under the wrong rules.
   * @param {string} id Stable game ID.
    * @returns {import("./types").GameDefinition} Registered game definition.
   * @throws {Error} If the ID is unknown.
   */
  function get(id) {
    const game = definitions[id];
    if (!game) throw new Error(`Unknown game "${id}". Add its definition to games/ before loading this data.`);
    return game;
  }

  /** @param {import("./types").GameDefinition} game Game definition. @returns {import("./types").TimingSettings} Effective timer settings for that program. */
  const timingFor = game => game.program === "VEX V5" ? V5_TIMING : { ...IQ_TIMING, ...game.timing };

  /** @param {unknown} item Record or object carrying an optional game tag. @returns {string} Its game ID, or the legacy game ID when untagged. */
  const of = item => item?.game ?? LEGACY_GAME_ID;
  /** @param {unknown} id Candidate game ID. @returns {boolean} Whether a definition is registered under that ID. */
  const validId = id => typeof id === "string" && Object.prototype.hasOwnProperty.call(definitions, id);
  /** @param {unknown[]} items Game-tagged records. @param {string} [id=ACTIVE_GAME_ID] Game ID to select. @returns {unknown[]} Records belonging to that game. */
  const forGame = (items, id = ACTIVE_GAME_ID) => items.filter(item => of(item) === id);
  /** @param {import("./types").GameDefinition} game Game definition. @returns {string} Program, name, and season label. */
  const label = game => `${game.program} ${game.name} (${game.season})`;

  const api = {
    ACTIVE_GAME_ID,
    LEGACY_GAME_ID,
    active: get(ACTIVE_GAME_ID),
    get,
    register,
    ids: () => Object.keys(definitions),
    of,
    validId,
    timingFor,
    forGame,
    label
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VexGame = api;
})(globalThis);
