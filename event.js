/** Validates event/backup state and rolls a session into another registered game. */
(function (root) {
  "use strict";
  const Core = typeof module !== "undefined" && module.exports ? require("./event-rules.js") : root.EventRules;
  const History = typeof module !== "undefined" && module.exports ? require("./history.js") : root.ScoreHistory;
  const Rubric = typeof module !== "undefined" && module.exports ? require("./rubric.js") : root.NotebookRubric;
  const Finals = typeof module !== "undefined" && module.exports ? require("./finals.js") : root.FinalsModel;
  const Game = Core.Game;

  /**
   * Normalize supported legacy fields, then validate every event-owned collection.
  * @param {Record<string, unknown>} candidate Parsed event or backup payload.
  * @returns {import("./types").EventState} Normalized, validated event; supported missing fields may be filled in.
   * @throws {Error} If any event or nested record violates its schema.
   */
  function validate(candidate) {
    if (!candidate || candidate.version !== 1 || typeof candidate.name !== "string" || candidate.name.length > 80 || !Array.isArray(candidate.teams) || candidate.teams.length > 200 || !Array.isArray(candidate.matches) || candidate.matches.length > 6000) throw new Error("This is not a valid event backup.");
    if (candidate.game === undefined) candidate.game = Game.LEGACY_GAME_ID;
    if (!Game.validId(candidate.game)) throw new Error(`This event uses unknown game "${candidate.game}". Add its definition to games/ before loading it.`);
    const game = Game.get(candidate.game);
    const ids = new Set();
    for (const team of candidate.teams) {
      if (!team || !/^[A-Z0-9-]{1,20}$/.test(team.id) || typeof team.name !== "string" || team.name.length < 1 || team.name.length > 80 || !Number.isFinite(team.draw) || ids.has(team.id)) throw new Error("Invalid or duplicate team in backup.");
      ids.add(team.id);
      if (team.includeInSchedule !== undefined && typeof team.includeInSchedule !== "boolean") throw new Error("Invalid team schedule inclusion setting.");
    }
    if (!Number.isInteger(candidate.rounds) || candidate.rounds < 1 || candidate.rounds > 30 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate.start) || !Number.isInteger(candidate.interval) || candidate.interval < 1 || candidate.interval > 60) throw new Error("Invalid schedule settings in backup.");
    candidate.matches.forEach((match, index) => {
      const invalid = reason => { throw new Error(`Invalid match in backup at position ${index + 1}: ${reason}`); };
      if (!match) invalid("match is missing.");
      if (match.phase !== undefined && match.phase !== "qualification") invalid("qualification phase is required.");
      if (match.id !== index + 1) invalid(`expected match ID ${index + 1}, received ${JSON.stringify(match.id)}.`);
      if (!Number.isInteger(match.round) || match.round < 1 || match.round > candidate.rounds) invalid(`round ${JSON.stringify(match.round)} is outside 1-${candidate.rounds}.`);
      if (!Array.isArray(match.teams) || match.teams.length !== 2 || match.teams[0] === match.teams[1]) invalid("expected two distinct teams.");
      if (!match.teams.every(id => ids.has(id))) invalid("a team is missing from the roster.");
      if (match.surrogate !== null && !match.teams.includes(match.surrogate)) invalid(`surrogate must be null or a participating team; received ${JSON.stringify(match.surrogate)}.`);
      if (match.result !== null) {
        Core.validateResult(match.result, game);
        if (!match.result.statuses || !match.teams.every(id => ["ok", "dq", "absent"].includes(match.result.statuses[id]))) throw new Error("Invalid match status in backup.");
      }
    });
    if (candidate.finals === undefined) candidate.finals = [];
    if (candidate.finalsWithdrawn === undefined) candidate.finalsWithdrawn = [];
    if (candidate.selectedPhase === undefined) candidate.selectedPhase = "qualification";
    if (!["qualification", "finals"].includes(candidate.selectedPhase)) throw new Error("Invalid selected match phase.");
    Finals.validate(candidate.teams, candidate.matches, candidate.finals, candidate.finalsWithdrawn, game);
    const selectedMatches = candidate.selectedPhase === "finals" ? candidate.finals : candidate.matches;
    if (candidate.selected !== null && !selectedMatches.some(match => match.id === candidate.selected)) throw new Error("Invalid selected match in backup.");
    if (candidate.skills === undefined) candidate.skills = [];
    if (candidate.skillsOnly === undefined) candidate.skillsOnly = false;
    if (typeof candidate.skillsOnly !== "boolean") throw new Error("Invalid skills event setting.");
    Core.validateSkills(candidate.teams, candidate.skills, game);
    if (candidate.rubrics === undefined) candidate.rubrics = [];
    Rubric.validate(candidate.rubrics);
    if (candidate.interviews === undefined) candidate.interviews = [];
    Rubric.Interview.validate(candidate.interviews);
    if (candidate.robots === undefined) candidate.robots = [];
    History.validateRobots(candidate.robots);
    delete candidate.officialTeamData;
    return History.initialize(candidate);
  }

  // Moves a validated event to another game. Each season has new teams, so the roster, robot versions,
  // schedule, finals, and skills are cleared; game-tagged score history and evaluations are kept for analysis.
  /**
   * Start a clean event for gameId while retaining game-tagged history and evaluations.
  * @param {import("./types").EventState} candidate Validated current event.
   * @param {string} [gameId=Game.ACTIVE_GAME_ID] Registered destination game ID.
  * @returns {import("./types").EventState} The original event when already in that game; otherwise a new empty event shell preserving its history.
   */
  function rollover(candidate, gameId = Game.ACTIVE_GAME_ID) {
    if (candidate.game === gameId) return candidate;
    Game.get(gameId);
    return { ...candidate, game: gameId, sessionId: History.newId(), teams: [], robots: [], skillsOnly: false, matches: [], finals: [], finalsWithdrawn: [], selectedPhase: "qualification", skills: [], selected: null };
  }

  const api = { validate, rollover };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EventModel = api;
})(globalThis);
