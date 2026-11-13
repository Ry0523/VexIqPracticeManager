(function (root) {
  "use strict";
  // Universal event rules. Game-specific scoring is delegated to the game definition (see game.js).
  const Game = typeof module !== "undefined" && module.exports ? require("./game.js") : root.VexGame;
  // VEX IQ match timing is the same every season: 60-second matches with a driver switch between 35 and 25 seconds remaining.
  const TIMING = Object.freeze({
    matchMs: 60000,
    driverSwitch: Object.freeze({ openMs: 35000, closeMs: 25000 }),
  });

  /**
   * Calculates a score using the selected game's scoring rules.
   * @param {number[]} counts Counts in the game's scoring-element order.
   * @param {import("./types").GameDefinition} [game=Game.active] Scoring definition.
   * @returns {number} Validated total points.
   */
  function score(counts, game = Game.active) {
    return game.score(counts);
  }

  /**
   * Calculates the qualification drop count for a number of appearances.
   * @param {number} played Completed non-surrogate appearances.
   * @returns {number} Scores excluded from the ranking average.
   */
  function dropCount(played) {
    return played < 4 ? 0 : Math.min(4, Math.floor(played / 4));
  }

  /**
   * Creates balanced qualification matches with surrogate turns for odd rosters.
   * @param {import("./types").Team[]} teams Included team roster.
   * @param {number} rounds Matches per team.
   * @param {() => number} [random=Math.random] Injectable random source for deterministic tests.
   * @returns {import("./types").Match[]} Unscored qualification schedule.
   */
  function schedule(teams, rounds, random = Math.random) {
    teams = teams.filter((team) => team.includeInSchedule !== false);
    if (teams.length < 2 || new Set(teams.map((team) => team.id)).size !== teams.length)
      throw new Error("Include at least two unique teams in the schedule.");
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 30)
      throw new Error("Matches per team must be between 1 and 30.");
    const matches = [];
    const pairs = new Map();
    const extras = new Map(teams.map((team) => [team.id, 0]));
    for (let round = 1; round <= rounds; round++) {
      const pool = teams.map((team) => team.id);
      for (let index = pool.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [pool[index], pool[other]] = [pool[other], pool[index]];
      }
      while (pool.length) {
        const first = pool.shift();
        const surrogate = pool.length === 0;
        const candidates = surrogate ? teams.map((team) => team.id).filter((id) => id !== first) : pool;
        /**
         * Scores the cost of pairing the first team with a candidate.
         *
         * @param {import("./types").TeamId} id Candidate opponent ID.
         * @returns {number} Pairing penalty for repeat, consecutive, and surrogate appearances.
         */
        const cost = (id) =>
          (pairs.get([first, id].sort().join("|")) || 0) * 10 +
          (matches[matches.length - 1]?.teams.includes(id) ? 2 : 0) +
          (surrogate ? extras.get(id) * 100 : 0);
        const second = candidates.reduce((best, id) => (cost(id) < cost(best) ? id : best));
        if (!surrogate) pool.splice(pool.indexOf(second), 1);
        else extras.set(second, extras.get(second) + 1);
        const key = [first, second].sort().join("|");
        pairs.set(key, (pairs.get(key) || 0) + 1);
        matches.push({
          id: matches.length + 1,
          round,
          teams: [first, second],
          surrogate: surrogate ? second : null,
          result: null,
        });
      }
    }
    return matches;
  }

  /**
   * Ranks teams by dropped-score average and the qualification tiebreak sequence.
   * @param {import("./types").Team[]} teams Roster records.
   * @param {import("./types").Match[]} matches Qualification matches and results.
   * @param {import("./types").GameDefinition} [game=Game.active] Scoring rules.
   * @returns {import("./types").StandingsRow[]} Ranked teams with score/drop details.
   */
  function standings(teams, matches, game = Game.active) {
    const rows = teams.map((team) => {
      const entries = matches
        .filter((match) => match.result && match.teams.includes(team.id) && match.surrogate !== team.id)
        .map((match) => {
          const status = match.result.statuses[team.id] || "ok";
          return {
            match: match.id,
            score: status === "ok" ? score(match.result.counts, game) : 0,
            protected: status === "absent",
          };
        });
      const excluded = new Set(
        entries
          .filter((entry) => !entry.protected)
          .sort((left, right) => left.score - right.score || left.match - right.match)
          .slice(0, dropCount(entries.length))
          .map((entry) => entry.match),
      );
      const keptEntries = entries.filter((entry) => !excluded.has(entry.match));
      const kept = keptEntries.map((entry) => entry.score).sort((left, right) => left - right);
      // T11 tiebreakers remove the next-lowest score, but a no-show zero is never excluded (T10).
      const tiebreakOrder = keptEntries
        .filter((entry) => !entry.protected)
        .map((entry) => entry.score)
        .sort((left, right) => left - right);
      const sum = kept.reduce((total, value) => total + value, 0);
      return {
        ...team,
        played: entries.length,
        excluded: [...excluded],
        kept,
        tiebreakOrder,
        sum,
        average: kept.length ? sum / kept.length : null,
        entries,
      };
    });
    rows.sort((left, right) => {
      /**
       * Breaks otherwise-equal standings by random draw, then team ID.
       *
       * @returns {number} Stable draw and team-ID ordering.
       */
      const byDraw = () => left.draw - right.draw || left.id.localeCompare(right.id, "en", { numeric: true });
      if (left.average === null || right.average === null)
        return left.average === right.average ? byDraw() : left.average === null ? 1 : -1;
      let leftSum = left.sum;
      let rightSum = right.sum;
      for (let removed = 0; ; removed++) {
        const comparison = rightSum * (left.kept.length - removed) - leftSum * (right.kept.length - removed);
        if (comparison) return comparison;
        if (
          removed >= Math.min(left.tiebreakOrder.length, right.tiebreakOrder.length) ||
          removed + 1 >= Math.min(left.kept.length, right.kept.length)
        )
          break;
        leftSum -= left.tiebreakOrder[removed];
        rightSum -= right.tiebreakOrder[removed];
      }
      return byDraw();
    });
    return rows;
  }

  /**
   * Renames or renumbers a team and remaps its existing match references.
   * @param {import("./types").Team[]} teams Current roster.
   * @param {import("./types").Match[]} matches Matches with possible references to the team.
   * @param {string} originalId Existing team ID.
   * @param {string} rawId Requested ID; normalized to uppercase.
   * @param {string} rawName Requested display name.
   * @returns {{teams: import("./types").Team[], matches: import("./types").Match[]}} Updated copies; inputs are not mutated.
   */
  function editTeam(teams, matches, originalId, rawId, rawName) {
    const id = rawId.trim().toUpperCase();
    const name = rawName.trim();
    if (!teams.some((team) => team.id === originalId)) throw new Error("Team no longer exists.");
    if (!/^[A-Z0-9-]{1,20}$/.test(id) || !name || name.length > 80)
      throw new Error("Enter a valid team number and a name of at most 80 characters.");
    if (teams.some((team) => team.id === id && team.id !== originalId))
      throw new Error(`Team ${id} already exists.`);
    return {
      teams: teams.map((team) => (team.id === originalId ? { ...team, id, name } : team)),
      matches: matches.map((match) => {
        if (!match.teams.includes(originalId)) return match;
        let result = match.result;
        if (result && id !== originalId) {
          const statuses = { ...result.statuses, [id]: result.statuses[originalId] };
          delete statuses[originalId];
          result = { ...result, statuses };
        }
        return {
          ...match,
          teams: match.teams.map((teamId) => (teamId === originalId ? id : teamId)),
          surrogate: match.surrogate === originalId ? id : match.surrogate,
          result,
        };
      }),
    };
  }

  /**
   * Validates game-owned goal data and aggregates it into scoring-element order.
   * @param {unknown} goals Game-specific goal breakdown.
   * @param {import("./types").GameDefinition} [game=Game.active] Owning game definition.
   * @returns {number[]} Aggregate counts for scoring.
   */
  function goalCounts(goals, game = Game.active) {
    return game.goalCounts(goals);
  }

  /**
   * Reconstructs game-owned goal data from aggregate counts.
   * @param {number[]} counts Counts in scoring-element order.
   * @param {import("./types").GameDefinition} [game=Game.active] Owning game definition.
   * @returns {unknown} Game-specific goal breakdown.
   */
  function goalsFromCounts(counts, game = Game.active) {
    return game.goalsFromCounts(counts);
  }

  /**
   * Creates an empty aggregate count vector for a game's scoring elements.
   * @param {import("./types").GameDefinition} [game=Game.active] Game definition.
   * @returns {number[]} Zero-filled scoring counts.
   */
  function emptyCounts(game = Game.active) {
    return game.scoring.elements.map(() => 0);
  }

  /**
   * Validates aggregate score counts and any saved goal breakdown.
   * @param {import("./types").MatchResult|import("./types").SkillsAttempt} result Result to validate.
   * @param {import("./types").GameDefinition} [game=Game.active] Owning game rules.
   * @param {string} [message] Error text when the breakdown does not match.
   * @returns {void} Throws when the result is invalid.
   */
  function validateResult(
    result,
    game = Game.active,
    message = "Goal breakdown does not match the saved score.",
  ) {
    score(result.counts, game);
    if (result.goals && goalCounts(result.goals, game).some((count, index) => count !== result.counts[index]))
      throw new Error(message);
  }

  /**
   * Validates Skills attempt slots, team references, scores, statuses, and Stop Time.
   * @param {import("./types").Team[]} teams Registered teams.
   * @param {import("./types").SkillsAttempt[]} attempts Attempts to validate.
   * @param {import("./types").GameDefinition} [game=Game.active] Scoring and tie-break rules.
   * @returns {import("./types").SkillsAttempt[]} The validated attempts, unchanged.
   */
  function validateSkills(teams, attempts, game = Game.active) {
    const seconds = TIMING.matchMs / 1000;
    if (!Array.isArray(attempts) || attempts.length > teams.length * 6)
      throw new Error("Each team has three driver and three autonomous skills attempts.");
    const teamIds = new Set(teams.map((team) => team.id));
    const slots = new Set();
    for (const entry of attempts) {
      if (
        !entry ||
        !teamIds.has(entry.team) ||
        !["driver", "autonomous"].includes(entry.mode) ||
        !Number.isInteger(entry.attempt) ||
        entry.attempt < 1 ||
        entry.attempt > 3 ||
        !["ok", "dq", "forfeit"].includes(entry.status) ||
        typeof entry.optIn !== "boolean" ||
        !Number.isInteger(entry.stopTime) ||
        entry.stopTime < 0 ||
        entry.stopTime > seconds ||
        ((!entry.optIn || entry.status !== "ok") && entry.stopTime !== 0)
      )
        throw new Error("Invalid skills attempt or stop time.");
      validateResult(entry, game, "Skills goal breakdown does not match the score.");
      const key = `${entry.team}:${entry.mode}:${entry.attempt}`;
      if (slots.has(key)) throw new Error("Duplicate skills attempt slot.");
      slots.add(key);
    }
    return attempts;
  }

  /**
   * Inserts or replaces one attempt in its team/mode/attempt slot.
   * @param {import("./types").Team[]} teams Registered teams.
   * @param {import("./types").SkillsAttempt[]} attempts Existing attempts.
   * @param {import("./types").SkillsAttempt} entry Attempt to insert or replace.
   * @param {import("./types").GameDefinition} [game=Game.active] Validation rules.
   * @returns {import("./types").SkillsAttempt[]} New validated attempts array.
   */
  function saveSkillAttempt(teams, attempts, entry, game = Game.active) {
    const updated = attempts
      .filter(
        (current) =>
          current.team !== entry.team || current.mode !== entry.mode || current.attempt !== entry.attempt,
      )
      .concat(entry);
    return validateSkills(teams, updated, game);
  }

  /**
   * Ranks each team's best Driver and Autonomous attempts with game tie-breaks.
   * @param {import("./types").Team[]} teams Roster rows to rank.
   * @param {import("./types").SkillsAttempt[]} attempts Saved Skills attempts.
   * @param {import("./types").TeamId[]} [eligibleIds=teams.map(team => team.id)] Teams eligible to receive a rank.
   * @param {import("./types").GameDefinition} [game=Game.active] Scoring and tie-break rules.
   * @returns {import("./types").SkillsStandingRow[]} Ranked Skills rows.
   */
  function skillsStandings(teams, attempts, eligibleIds = teams.map((team) => team.id), game = Game.active) {
    validateSkills(teams, attempts, game);
    const tiebreakLength = game.skillsTiebreak(emptyCounts(game)).length;
    /**
     * Creates an empty Skills tiebreak key of the game-defined length.
     *
     * @returns {number[]} Zero-filled tiebreak key.
     */
    const noTiebreak = () => Array(tiebreakLength).fill(0);
    const eligible = new Set(eligibleIds);
    /**
     * Compares ordered Skills tiebreak keys with larger values ranked first.
     *
     * @param {number[]} left First tiebreak key.
     * @param {number[]} right Second tiebreak key.
     * @returns {number} Ordering result.
     */
    const compareKey = (left, right) => {
      for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return right[index] - left[index];
      }
      return 0;
    };
    const rows = teams.map((team) => {
      const entries = attempts.filter((entry) => entry.team === team.id);
      const modes = {};
      for (const mode of ["driver", "autonomous"]) {
        modes[mode] = entries
          .filter((entry) => entry.mode === mode)
          .map((entry) => {
            const valid = entry.status === "ok";
            const value = valid ? score(entry.counts, game) : 0;
            const stop = valid && entry.optIn ? entry.stopTime : 0;
            const levels = valid ? game.skillsTiebreak(entry.counts) : noTiebreak();
            return { ...entry, value, stop, levels, key: [value, stop, ...levels] };
          })
          .sort((left, right) => compareKey(left.key, right.key) || left.attempt - right.attempt);
      }
      const auto = modes.autonomous;
      const driver = modes.driver;
      const bestAuto = auto[0]?.value || 0;
      const bestDriver = driver[0]?.value || 0;
      const autoStop = auto[0]?.stop || 0;
      const driverStop = driver[0]?.stop || 0;
      const key = [
        bestAuto + bestDriver,
        bestAuto,
        auto[1]?.value || 0,
        driver[1]?.value || 0,
        autoStop + driverStop,
        autoStop,
        auto[2]?.value || 0,
        driver[2]?.value || 0,
        ...(auto[0]?.levels || noTiebreak()),
        ...(driver[0]?.levels || noTiebreak()),
      ];
      return {
        ...team,
        eligible: eligible.has(team.id),
        entered: entries.length > 0,
        modes,
        bestAuto,
        bestDriver,
        total: bestAuto + bestDriver,
        autoStop,
        driverStop,
        key,
        rank: null,
      };
    });
    rows.sort(
      (left, right) =>
        Number(right.eligible && right.entered) - Number(left.eligible && left.entered) ||
        compareKey(left.key, right.key) ||
        left.id.localeCompare(right.id, "en", { numeric: true }),
    );
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

  const api = {
    Game,
    TIMING,
    score,
    dropCount,
    schedule,
    standings,
    editTeam,
    goalCounts,
    goalsFromCounts,
    emptyCounts,
    validateResult,
    validateSkills,
    saveSkillAttempt,
    skillsStandings,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MatchCore = api;
})(globalThis);
