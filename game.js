(function (root) {
  "use strict";
  // Season flag: set this to the id of the game definition in games/ that the app should run.
  // Events and evaluations saved under another game are archived when the app next loads.
  const ACTIVE_GAME_ID = "level-up";
  // Records saved before games were tracked belong to this game.
  const LEGACY_GAME_ID = "level-up";

  const definitions = typeof module !== "undefined" && module.exports
    ? Object.fromEntries([require("./games/level-up/definition.js")].map(game => [game.id, game]))
    : root.VexGameDefinitions || {};

  const REQUIRED = ["id", "name", "program", "season", "manual", "scoring", "score", "emptyGoals", "goalCounts", "goalsFromCounts", "layout", "skillsTiebreak", "csv"];
  const check = game => {
    const missing = REQUIRED.filter(key => game[key] === undefined);
    if (missing.length) throw new Error(`Game definition ${game.id || "(unnamed)"} is missing: ${missing.join(", ")}.`);
    return game;
  };
  Object.values(definitions).forEach(check);

  function register(game) {
    if (Object.prototype.hasOwnProperty.call(definitions, game.id)) throw new Error(`Game "${game.id}" is already registered.`);
    definitions[game.id] = check(game);
    return game;
  }

  function get(id) {
    const game = definitions[id];
    if (!game) throw new Error(`Unknown game "${id}". Add its definition to games/ before loading this data.`);
    return game;
  }

  const of = item => item?.game ?? LEGACY_GAME_ID;
  const validId = id => typeof id === "string" && Object.prototype.hasOwnProperty.call(definitions, id);

  const api = {
    ACTIVE_GAME_ID,
    LEGACY_GAME_ID,
    active: get(ACTIVE_GAME_ID),
    get,
    register,
    ids: () => Object.keys(definitions),
    of,
    validId,
    forGame: (items, id = ACTIVE_GAME_ID) => items.filter(item => of(item) === id),
    label: game => `${game.program} ${game.name} (${game.season})`
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VexGame = api;
})(globalThis);
