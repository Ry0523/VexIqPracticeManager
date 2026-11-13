/** Qualification schedule generation and ranking/drop rules shared across games. */
(function (root) {
  "use strict";
  const Scoring =
    typeof module !== "undefined" && module.exports ? require("./scoring.js") : root.MatchScoring;
  const Game = Scoring.Game;

  /**
   * Calculates how many qualification scores to drop under the shared thresholds.
   * @param {number} played Completed non-surrogate appearances.
   * @returns {number} Number of scores excluded from the average.
   */
  function dropCount(played) {
    return played < 4 ? 0 : Math.min(4, Math.floor(played / 4));
  }

  /**
   * Build one match per team per round; odd fields receive a surrogate appearance.
   * @param {import("./types").Team[]} teams Roster records; includeInSchedule=false excludes a team.
   * @param {number} rounds Matches per team.
   * @param {() => number} [random=Math.random] Random source returning values in [0,1), injectable for deterministic tests.
   * @returns {import("./types").Match[]} Ordered matches with IDs, round, participants, surrogate, and null result.
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
        // Prefer opponents seen fewer times, avoid consecutive pairings, and balance surrogate turns.
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
   * Apply game-independent drop thresholds and T11 ordering to posted qualification scores.
   * @param {import("./types").Team[]} teams Roster records with draw values.
   * @param {import("./types").Match[]} matches Qualification matches and posted results.
   * @param {import("./types").GameDefinition} [game=Game.active] Game scoring definition.
   * @returns {import("./types").StandingsRow[]} Standings rows including averages, drops, and tiebreak order.
   */
  function standings(teams, matches, game = Game.active) {
    const rows = teams.map((team) => {
      const entries = matches
        .filter((match) => match.result && match.teams.includes(team.id) && match.surrogate !== team.id)
        .map((match) => {
          const status = match.result.statuses[team.id] || "ok";
          return {
            match: match.id,
            score: status === "ok" ? Scoring.score(match.result.counts, game) : 0,
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
      // Absent/no-show zeroes remain protected from both average drops and successive-lowest tiebreak drops.
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

  const api = { dropCount, schedule, standings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MatchScheduling = api;
})(globalThis);
