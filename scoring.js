/** Shared scoring validators and Skills ranking; game-specific points and tie rules come from VexGame. */
(function (root) {
  "use strict";
  const Game = typeof module !== "undefined" && module.exports ? require("./game.js") : root.VexGame;
  const timing = Game.timingFor(Game.active);
  const TIMING = Object.freeze({ matchMs: timing.matchMs, driverSwitch: timing.driverSwitch ? Object.freeze({ ...timing.driverSwitch }) : null });

  /**
   * Score aggregate counts using the selected game's scoring rules.
   * @param {number[]} counts Per-element counts in the game's scoring order.
  * @param {import("./types").GameDefinition} [game=Game.active] Game definition supplying score().
   * @returns {number} Validated total score.
   */
  function score(counts, game = Game.active) {
    return game.score(counts);
  }

  /** @param {unknown} goals Game-owned goal breakdown. @param {import("./types").GameDefinition} [game=Game.active] Definition that validates and totals goals. @returns {number[]} Counts in scoring-element order. */
  function goalCounts(goals, game = Game.active) {
    return game.goalCounts(goals);
  }

  /** @param {number[]} counts Aggregate counts in scoring-element order. @param {object} [game=Game.active] Definition that reconstructs its goal shape. @returns {object} Game-owned goal breakdown. */
  function goalsFromCounts(counts, game = Game.active) {
    return game.goalsFromCounts(counts);
  }

  /** @param {import("./types").GameDefinition} [game=Game.active] Game whose scoring elements determine array length. @returns {number[]} Zero-filled element counts. */
  function emptyCounts(game = Game.active) {
    return game.scoring.elements.map(() => 0);
  }

  /** @param {import("./types").MatchResult|import("./types").SkillsAttempt} result Result containing counts and optional goals. @param {import("./types").GameDefinition} [game=Game.active] Owning game definition. @param {string} [message] Error text for a mismatched breakdown. @returns {void} Throws if score or breakdown is invalid. */
  function validateResult(result, game = Game.active, message = "Goal breakdown does not match the saved score.") {
    score(result.counts, game);
    if (result.goals && goalCounts(result.goals, game).some((count, index) => count !== result.counts[index])) throw new Error(message);
  }

  /**
   * Validate one active-attempt set, including unique team/mode/attempt slots and Stop Time.
  * @param {import("./types").Team[]} teams Registered team records.
  * @param {import("./types").SkillsAttempt[]} attempts Skills attempts to validate.
  * @param {import("./types").GameDefinition} [game=Game.active] Game rules used for score checks.
  * @returns {import("./types").SkillsAttempt[]} The validated attempts, unchanged.
   */
  function validateSkills(teams, attempts, game = Game.active) {
    const seconds = TIMING.matchMs / 1000;
    if (!Array.isArray(attempts) || attempts.length > teams.length * 6) throw new Error("Each team has three driver and three autonomous skills attempts.");
    const teamIds = new Set(teams.map(team => team.id));
    const slots = new Set();
    for (const entry of attempts) {
      if (!entry || !teamIds.has(entry.team) || !["driver", "autonomous"].includes(entry.mode) || !Number.isInteger(entry.attempt) || entry.attempt < 1 || entry.attempt > 3 || !["ok", "dq", "forfeit"].includes(entry.status) || typeof entry.optIn !== "boolean" || !Number.isInteger(entry.stopTime) || entry.stopTime < 0 || entry.stopTime > seconds || ((!entry.optIn || entry.status !== "ok") && entry.stopTime !== 0)) throw new Error("Invalid skills attempt or stop time.");
      validateResult(entry, game, "Skills goal breakdown does not match the score.");
      const key = `${entry.team}:${entry.mode}:${entry.attempt}`;
      if (slots.has(key)) throw new Error("Duplicate skills attempt slot.");
      slots.add(key);
    }
    return attempts;
  }

  /** @param {import("./types").Team[]} teams Registered team records. @param {import("./types").SkillsAttempt[]} attempts Existing attempts. @param {import("./types").SkillsAttempt} entry Attempt to insert or replace in its team/mode/slot. @param {import("./types").GameDefinition} [game=Game.active] Game rules used for validation. @returns {import("./types").SkillsAttempt[]} A new validated attempts array. */
  function saveSkillAttempt(teams, attempts, entry, game = Game.active) {
    const updated = attempts.filter(current => current.team !== entry.team || current.mode !== entry.mode || current.attempt !== entry.attempt).concat(entry);
    return validateSkills(teams, updated, game);
  }

  /**
   * Rank eligible teams by their best three attempts and the game's ordered tie-break key.
  * @param {import("./types").Team[]} teams Teams to include in output.
  * @param {import("./types").SkillsAttempt[]} attempts Saved Skills attempts.
  * @param {import("./types").TeamId[]} [eligibleIds] Team IDs allowed to receive a rank.
  * @param {import("./types").GameDefinition} [game=Game.active] Scoring and tie-break rules.
  * @returns {import("./types").SkillsStandingRow[]} Ranked rows, with unentered/ineligible teams left unranked.
   */
  function skillsStandings(teams, attempts, eligibleIds = teams.map(team => team.id), game = Game.active) {
    validateSkills(teams, attempts, game);
    const tiebreakLength = game.skillsTiebreak(emptyCounts(game)).length;
    const noTiebreak = () => Array(tiebreakLength).fill(0);
    const eligible = new Set(eligibleIds);
    const compareKey = (left, right) => {
      for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return right[index] - left[index];
      }
      return 0;
    };
    const rows = teams.map(team => {
      const entries = attempts.filter(entry => entry.team === team.id);
      const modes = {};
      for (const mode of ["driver", "autonomous"]) {
        modes[mode] = entries.filter(entry => entry.mode === mode).map(entry => {
          const valid = entry.status === "ok";
          const value = valid ? score(entry.counts, game) : 0;
          const stop = valid && entry.optIn ? entry.stopTime : 0;
          const levels = valid ? game.skillsTiebreak(entry.counts) : noTiebreak();
          return { ...entry, value, stop, levels, key: [value, stop, ...levels] };
        }).sort((left, right) => compareKey(left.key, right.key) || left.attempt - right.attempt);
      }
      const auto = modes.autonomous;
      const driver = modes.driver;
      const bestAuto = auto[0]?.value || 0;
      const bestDriver = driver[0]?.value || 0;
      const autoStop = auto[0]?.stop || 0;
      const driverStop = driver[0]?.stop || 0;
      // The game supplies level-specific suffixes; shared ordering prioritizes total, best Auto,
      // second scores, and the agreed Stop Time fields before those final game-specific keys.
      const key = [bestAuto + bestDriver, bestAuto, auto[1]?.value || 0, driver[1]?.value || 0, autoStop + driverStop, autoStop, auto[2]?.value || 0, driver[2]?.value || 0, ...(auto[0]?.levels || noTiebreak()), ...(driver[0]?.levels || noTiebreak())];
      return { ...team, eligible: eligible.has(team.id), entered: entries.length > 0, modes, bestAuto, bestDriver, total: bestAuto + bestDriver, autoStop, driverStop, key, rank: null };
    });
    rows.sort((left, right) => Number(right.eligible && right.entered) - Number(left.eligible && left.entered) || compareKey(left.key, right.key) || left.id.localeCompare(right.id, "en", { numeric: true }));
    let position = 0;
    let previous = null;
    for (const row of rows) {
      if (!row.eligible || !row.entered) continue;
      position++;
      row.rank = previous && compareKey(previous.key, row.key) === 0 ? previous.rank : position;
      previous = row;
    }
    return rows;
  }

  const api = { Game, TIMING, score, goalCounts, goalsFromCounts, emptyCounts, validateResult, validateSkills, saveSkillAttempt, skillsStandings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MatchScoring = api;
})(globalThis);