(function (root) {
  "use strict";
  // VEX IQ game definition. Scoring, layout, standings configuration, and manual links for this season live here.
  // game.js handles registration and the active-game flag.
  const POINTS = [1, 3, 6, 12, 16];
  const MAX_BAGS = 38;
  const LEVELS = ["Floor", "L1", "L2", "L3"];
  const isCount = value => Number.isInteger(value) && value >= 0;

  function score(counts) {
    if (!Array.isArray(counts) || counts.length !== POINTS.length || counts.some(value => !isCount(value)) || counts.reduce((sum, value) => sum + value, 0) > MAX_BAGS) {
      throw new Error(`Enter whole bag counts, with no more than ${MAX_BAGS} bags total.`);
    }
    return counts.reduce((sum, value, index) => sum + value * POINTS[index], 0);
  }

  function emptyGoals() {
    return { blue: [0, 0, 0, 0], red: [0, 0, 0, 0], unassigned: [0, 0, 0, 0], top: 0 };
  }

  function goalCounts(goals) {
    if (!goals || ![goals.blue, goals.red, goals.unassigned].every(group => Array.isArray(group) && group.length === 4 && group.every(isCount)) || !isCount(goals.top)) {
      throw new Error("Enter whole, nonnegative bag counts for each goal.");
    }
    const counts = goals.blue.map((value, index) => value + goals.red[index] + goals.unassigned[index]);
    counts.push(goals.top);
    score(counts);
    return counts;
  }

  function goalsFromCounts(counts) {
    score(counts);
    return { ...emptyGoals(), unassigned: counts.slice(0, 4), top: counts[4] };
  }

  const tower = '<div class="goal-diagram goal-visual" aria-hidden="true"><div class="tower-tier tower-l3">L3</div><div class="tower-tier tower-l2">L2</div><div class="tower-tier tower-l1">L1</div><div class="tower-floor">Floor</div></div>';
  const towerGroup = (id, short, title, color, wash, extra = {}) => ({
    id, title, color, wash, diagram: tower,
    inputs: [3, 2, 1, 0].map(level => ({ path: [id, level], label: LEVELS[level], ariaLabel: `${short} ${LEVELS[level]}`, element: level })),
    ...extra
  });

  const definition = {
    id: "level-up",
    name: "Level Up",
    program: "VEX IQ",
    season: "2026\u20132027",
    fieldImage: "games/level-up/field.png",
    teamProfileProgram: "VIQRC",
    officialStandings: {
      sourceUrl: "https://events.vex.com/robot-competitions/vex-iq-competition/standings/skills",
      apiUrl: "https://events.vex.com/api/seasons/203/skills?post_season=0",
      country: "United States",
      countryId: 244,
      region: "Ohio",
      regionId: 47,
      groups: [{ gradeLevel: "Elementary", teamPrefix: "28101" }, { gradeLevel: "Middle School", teamPrefix: "28102" }],
    },
    manual: {
      url: "https://manuals.vex.com/iq/level-up/v2.1/event/",
      label: "Official rules v2.1",
      rules: {
        schedule: { anchor: "t9", label: "T9" },
        finals: { anchor: "t12", label: "T12-T14" },
        skills: { anchor: "t17", label: "T17" }
      }
    },
    scoring: {
      object: "bag",
      objects: "bags",
      maxObjects: MAX_BAGS,
      elements: [
        { id: "floor", label: "Floor", points: POINTS[0] },
        { id: "l1", label: "L1", points: POINTS[1] },
        { id: "l2", label: "L2", points: POINTS[2] },
        { id: "l3", label: "L3", points: POINTS[3] },
        { id: "l4", label: "L4", points: POINTS[4] }
      ]
    },
    score,
    emptyGoals,
    goalCounts,
    goalsFromCounts,
    layout: [
      towerGroup("blue", "Blue", "Blue goal", "#79c9ff", "#183c53"),
      towerGroup("red", "Red", "Red goal", "#ff8c9c", "#4c2630"),
      towerGroup("unassigned", "Unassigned", "Unassigned goals", "#b4b4b4", "#303030", { optional: goals => goals.unassigned.some(count => count > 0), note: "Goal colors not recorded in this earlier result." }),
      { id: "top", title: "Shared top goal", color: "#f1ce68", wash: "#4b4126", diagram: '<div class="top-goal-diagram goal-visual" aria-hidden="true"><span>L4</span></div>', inputs: [{ path: ["top"], label: "L4", ariaLabel: "Shared L4", element: 4 }] }
    ],
    // T17: after score and Stop Time, skills ties compare points scored in the highest goal levels.
    skillsTiebreak: counts => [counts[4] * POINTS[4], counts[3] * POINTS[3], counts[2] * POINTS[2]],
    csv: {
      headers: [
        ...["Floor", "L1", "L2", "L3", "L4"].map(level => `${level} bags`),
        "Goal breakdown recorded",
        ...["Blue", "Red", "Unassigned"].flatMap(group => LEVELS.map(level => `${group} ${level} bags`)),
        "Shared L4 bags"
      ],
      values: result => [...result.counts, Boolean(result.goals), ...["blue", "red", "unassigned"].flatMap(group => result.goals ? result.goals[group] : ["", "", "", ""]), result.goals?.top ?? ""]
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = definition;
  else (root.VexGameDefinitions = root.VexGameDefinitions || {})[definition.id] = definition;
})(globalThis);

/** Registers game definitions and exposes active-game identity, timing, and lookup helpers. */
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
/** Qualification schedule generation and ranking/drop rules shared across games. */
(function (root) {
  "use strict";
  const Scoring = typeof module !== "undefined" && module.exports ? require("./scoring.js") : root.MatchScoring;
  const Game = Scoring.Game;

  /** @param {number} played Number of completed non-surrogate appearances. @returns {number} Qualification scores to drop under the shared thresholds. */
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
    teams = teams.filter(team => team.includeInSchedule !== false);
    if (teams.length < 2 || new Set(teams.map(team => team.id)).size !== teams.length) throw new Error("Include at least two unique teams in the schedule.");
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 30) throw new Error("Matches per team must be between 1 and 30.");
    const matches = [];
    const pairs = new Map();
    const extras = new Map(teams.map(team => [team.id, 0]));
    for (let round = 1; round <= rounds; round++) {
      const pool = teams.map(team => team.id);
      for (let index = pool.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [pool[index], pool[other]] = [pool[other], pool[index]];
      }
      while (pool.length) {
        const first = pool.shift();
        const surrogate = pool.length === 0;
        const candidates = surrogate ? teams.map(team => team.id).filter(id => id !== first) : pool;
        // Prefer opponents seen fewer times, avoid consecutive pairings, and balance surrogate turns.
        const cost = id => (pairs.get([first, id].sort().join("|") ) || 0) * 10 + (matches[matches.length - 1]?.teams.includes(id) ? 2 : 0) + (surrogate ? extras.get(id) * 100 : 0);
        const second = candidates.reduce((best, id) => cost(id) < cost(best) ? id : best);
        if (!surrogate) pool.splice(pool.indexOf(second), 1);
        else extras.set(second, extras.get(second) + 1);
        const key = [first, second].sort().join("|");
        pairs.set(key, (pairs.get(key) || 0) + 1);
        matches.push({ id: matches.length + 1, round, teams: [first, second], surrogate: surrogate ? second : null, result: null });
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
    const rows = teams.map(team => {
      const entries = matches.filter(match => match.result && match.teams.includes(team.id) && match.surrogate !== team.id).map(match => {
        const status = match.result.statuses[team.id] || "ok";
        return { match: match.id, score: status === "ok" ? Scoring.score(match.result.counts, game) : 0, protected: status === "absent" };
      });
      const excluded = new Set(entries.filter(entry => !entry.protected).sort((left, right) => left.score - right.score || left.match - right.match).slice(0, dropCount(entries.length)).map(entry => entry.match));
      const keptEntries = entries.filter(entry => !excluded.has(entry.match));
      const kept = keptEntries.map(entry => entry.score).sort((left, right) => left - right);
      // Absent/no-show zeroes remain protected from both average drops and successive-lowest tiebreak drops.
      const tiebreakOrder = keptEntries.filter(entry => !entry.protected).map(entry => entry.score).sort((left, right) => left - right);
      const sum = kept.reduce((total, value) => total + value, 0);
      return { ...team, played: entries.length, excluded: [...excluded], kept, tiebreakOrder, sum, average: kept.length ? sum / kept.length : null, entries };
    });
    rows.sort((left, right) => {
      const byDraw = () => left.draw - right.draw || left.id.localeCompare(right.id, "en", { numeric: true });
      if (left.average === null || right.average === null) return left.average === right.average ? byDraw() : left.average === null ? 1 : -1;
      let leftSum = left.sum;
      let rightSum = right.sum;
      for (let removed = 0; ; removed++) {
        const comparison = rightSum * (left.kept.length - removed) - leftSum * (right.kept.length - removed);
        if (comparison) return comparison;
        if (removed >= Math.min(left.tiebreakOrder.length, right.tiebreakOrder.length) || removed + 1 >= Math.min(left.kept.length, right.kept.length)) break;
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
/** Roster identity operations that must keep references in posted event matches consistent. */
(function (root) {
  "use strict";

  /**
   * Rename/renumber a team and remap match participants, surrogates, and saved statuses.
  * @param {import("./types").Team[]} teams Current roster.
  * @param {import("./types").Match[]} matches Matches whose references must be remapped.
   * @param {string} originalId Existing team ID.
   * @param {string} rawId Requested ID; normalized to uppercase.
   * @param {string} rawName Requested display name.
  * @returns {{teams: import("./types").Team[], matches: import("./types").Match[]}} New roster and match arrays; inputs are not mutated.
   */
  function editTeam(teams, matches, originalId, rawId, rawName) {
    const id = rawId.trim().toUpperCase();
    const name = rawName.trim();
    if (!teams.some(team => team.id === originalId)) throw new Error("Team no longer exists.");
    if (!/^[A-Z0-9-]{1,20}$/.test(id) || !name || name.length > 80) throw new Error("Enter a valid team number and a name of at most 80 characters.");
    if (teams.some(team => team.id === id && team.id !== originalId)) throw new Error(`Team ${id} already exists.`);
    return {
      teams: teams.map(team => team.id === originalId ? { ...team, id, name } : team),
      matches: matches.map(match => {
        if (!match.teams.includes(originalId)) return match;
        let result = match.result;
        if (result && id !== originalId) {
          const statuses = { ...result.statuses, [id]: result.statuses[originalId] };
          delete statuses[originalId];
          result = { ...result, statuses };
        }
        return { ...match, teams: match.teams.map(teamId => teamId === originalId ? id : teamId), surrogate: match.surrogate === originalId ? id : match.surrogate, result };
      })
    };
  }

  const api = { editTeam };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TeamRoster = api;
})(globalThis);
/** Browser/Node facade for shared scoring, schedule, and roster rule modules. */
(function (root) {
  "use strict";
  const modules = typeof module !== "undefined" && module.exports
    ? [require("./scoring.js"), require("./scheduling.js"), require("./teams.js")]
    : [root.MatchScoring, root.MatchScheduling, root.TeamRoster];
  const api = Object.assign({}, ...modules);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EventRules = api;
})(globalThis);
/** Finals bracket rules: qualification eligibility, seeding, series, and withdrawals. */
(function (root) {
  "use strict";
  const Core = typeof module !== "undefined" && module.exports ? require("./event-rules.js") : root.EventRules;
  const Game = Core.Game;

  /** @param {import("./types").Team[]} teams Full roster. @param {import("./types").Match[]} qualifications Qualification matches. @param {import("./types").GameDefinition} [game=Game.active] Rules for qualification standings. @returns {import("./types").StandingsRow[]} Ranked teams with at least one qualification appearance. */
  function eligible(teams, qualifications, game = Game.active) {
    return Core.standings(teams, qualifications, game).filter(team => qualifications.some(match => match.teams.includes(team.id) && match.surrogate !== team.id));
  }

  /**
   * Create a finals bracket in lowest-seed-first play order from qualification standings.
  * @param {import("./types").Team[]} teams Full roster.
  * @param {import("./types").Match[]} qualifications Fully posted qualification matches.
   * @param {number} count Even number of advancing teams.
   * @param {object} [game=Game.active] Rules for qualification standings.
  * @returns {import("./types").FinalsMatch[]} Initial finals matches with seed, alliance, and play-order IDs.
   */
  function generate(teams, qualifications, count, game = Game.active) {
    if (!qualifications.length || qualifications.some(match => !match.result)) throw new Error("Post every qualification result before generating finals.");
    const ranked = eligible(teams, qualifications, game);
    if (!Number.isInteger(count) || count < 2 || count % 2 || count > ranked.length) throw new Error("Choose an even number of advancing teams, from 2 up to the number of qualified teams.");
    const alliances = [];
    for (let index = 0; index < count; index += 2) alliances.push({ seed: index / 2 + 1, teams: ranked.slice(index, index + 2).map(team => team.id) });
    return alliances.reverse().map((alliance, index) => ({ ...alliance, phase: "finals", id: index + 1, round: 1, surrogate: null, result: null }));
  }

  /** @param {import("./types").FinalsMatch} match Finals match. @param {import("./types").GameDefinition} [game=Game.active] Scoring definition. @returns {?number} Alliance score, or null until posted. */
  function score(match, game = Game.active) {
    if (!match.result) return null;
    return match.teams.some(id => match.result.statuses[id] === "dq") || match.teams.every(id => match.result.statuses[id] === "absent") ? 0 : Core.score(match.result.counts, game);
  }

  /** @param {import("./types").FinalsMatch} match Posted finals match. @returns {number} Stop Time in seconds, or zero for an alliance disqualification/all-no-show. */
  function stopTime(match) {
    return match.teams.some(id => match.result.statuses[id] === "dq") || match.teams.every(id => match.result.statuses[id] === "absent") ? 0 : match.result.stopTime;
  }

  /** @param {import("./types").FinalsMatch} match Finals match to validate. @param {import("./types").Team[]} teams Current roster. @param {import("./types").GameDefinition} [game=Game.active] Scoring and timer rules. @returns {import("./types").FinalsMatch} The same validated match. @throws {Error} If alliance, result, or Stop Time fields are invalid. */
  function validateMatch(match, teams, game = Game.active) {
    if (!match || match.phase !== "finals" || !Number.isInteger(match.id) || match.id < 1 || !Number.isInteger(match.seed) || match.seed < 1 || ![1, 2, 3].includes(match.round) || match.surrogate !== null || !Array.isArray(match.teams) || match.teams.length < 1 || match.teams.length > 2 || new Set(match.teams).size !== match.teams.length || !match.teams.every(id => teams.some(team => team.id === id))) throw new Error("Invalid finals match or alliance.");
    if (match.result !== null) {
      Core.validateResult(match.result, game, "Finals goal breakdown does not match the score.");
      if (!match.result.statuses || !match.teams.every(id => ["ok", "dq", "absent"].includes(match.result.statuses[id]))) throw new Error("Invalid finals result status.");
      if (!Number.isInteger(match.result.stopTime) || match.result.stopTime < 0 || match.result.stopTime > Core.TIMING.matchMs / 1000 || (match.round === 1 && match.result.stopTime !== 0)) throw new Error(`Finals Stop Time must be 0-${Core.TIMING.matchMs / 1000} seconds and is only used in tiebreakers.`);
    }
    return match;
  }

  /** @param {import("./types").FinalsMatch[]} matches Finals matches through the current round. @param {import("./types").GameDefinition} [game=Game.active] Scoring rules. @returns {import("./types").FinalsOutcome} Current result and any unresolved first-place series. */
  function outcome(matches, game = Game.active) {
    const initial = matches.filter(match => match.round === 1);
    const rows = initial.map(match => ({ seed: match.seed, teams: match.teams, score: score(match, game), rank: null, matches: matches.filter(item => item.seed === match.seed) }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.seed - b.seed);
    if (!initial.length || initial.some(match => !match.result)) {
      rows.forEach((row, index) => { if (row.score !== null) row.rank = index + 1; });
      return { rows, complete: false, pending: [], nextRound: null, champion: null };
    }
    const top = rows[0].score;
    let contenders = rows.filter(row => row.score === top).map(row => row.seed);
    for (let round = 2; round <= 3 && contenders.length > 1; round++) {
      const current = matches.filter(match => match.round === round);
      if (!current.length) return { rows, complete: false, pending: contenders, nextRound: round, champion: null };
      if (current.some(match => !match.result)) return { rows, complete: false, pending: contenders, nextRound: null, champion: null };
      const best = Math.max(...current.map(match => score(match, game)));
      let winners = current.filter(match => score(match, game) === best);
      const stop = Math.max(...winners.map(match => stopTime(match)));
      winners = winners.filter(match => stopTime(match) === stop);
      const advancing = winners.map(match => match.seed);
      contenders = advancing;
    }
    const champion = Math.min(...contenders);
    // Tiebreaker series decide first place only; all other initial-score ties use seed.
    const order = [champion, ...rows.filter(row => row.seed !== champion).map(row => row.seed)];
    rows.sort((a, b) => order.indexOf(a.seed) - order.indexOf(b.seed));
    rows.forEach((row, index) => { row.rank = index + 1; });
    return { rows, complete: true, pending: [], nextRound: null, champion };
  }

  /** @param {import("./types").FinalsMatch[]} matches Existing finals series. @param {import("./types").GameDefinition} [game=Game.active] Scoring/tie rules. @returns {import("./types").FinalsMatch[]} Next round's matches for unresolved top seeds. @throws {Error} If no new tiebreaker is due. */
  function tiebreakers(matches, game = Game.active) {
    const status = outcome(matches, game);
    if (!status.nextRound) throw new Error("Finish the current finals series first; a new tiebreaker is only needed for an unresolved first-place tie.");
    return status.pending.slice().sort((a, b) => b - a).map((seed, index) => ({
      ...matches.find(match => match.round === 1 && match.seed === seed),
      id: matches.length + index + 1, round: status.nextRound, result: null
    }));
  }

  /** @param {import("./types").Team[]} teams Current roster. @param {import("./types").Match[]} qualifications Qualification schedule/results. @param {import("./types").FinalsMatch[]} matches Finals bracket. @param {string[]} [withdrawn] Team IDs withdrawn from finals. @param {import("./types").GameDefinition} [game=Game.active] Game scoring rules. @returns {import("./types").FinalsMatch[]} The validated finals matches. */
  function validate(teams, qualifications, matches, withdrawn = [], game = Game.active) {
    if (!Array.isArray(matches) || matches.length > 300 || !Array.isArray(withdrawn) || new Set(withdrawn).size !== withdrawn.length || withdrawn.some(id => !teams.some(team => team.id === id))) throw new Error("Invalid finals schedule or withdrawn teams.");
    if (!matches.length) {
      if (withdrawn.length) throw new Error("Withdrawn finals teams require a finals schedule.");
      return matches;
    }
    if (!qualifications.length || qualifications.some(match => !match.result)) throw new Error("Finals require completed qualification results.");
    matches.forEach(match => validateMatch(match, teams, game));
    const used = new Set();
    const slots = new Set();
    const qualified = new Set(eligible(teams, qualifications, game).map(team => team.id));
    const initial = matches.filter(match => match.round === 1);
    if (!initial.length || initial.length > Math.floor(qualified.size / 2)) throw new Error("Invalid number of finals alliances.");
    const prefix = [];
    for (const [index, match] of matches.entries()) {
      const slot = `${match.round}:${match.seed}`;
      if (slots.has(slot) || (prefix[prefix.length - 1]?.round || 1) > match.round) throw new Error("Duplicate or out-of-order finals match.");
      slots.add(slot);
      if (match.id !== index + 1) throw new Error("Finals match IDs must follow play order.");
      if (match.round === 1) {
        if (index >= initial.length || match.seed !== initial.length - index || match.teams.some(id => used.has(id) || withdrawn.includes(id))) throw new Error("Finals alliances must be unique and play lowest seed first.");
        match.teams.forEach(id => used.add(id));
        if (match.teams.some(id => !qualified.has(id))) throw new Error("Finals teams must have qualification appearances.");
      } else {
        const first = initial.find(item => item.seed === match.seed);
        if (!first || JSON.stringify(first.teams) !== JSON.stringify(match.teams)) throw new Error("Tiebreakers must retain their finals alliance.");
        if (prefix[prefix.length - 1]?.round !== match.round) {
          const expected = tiebreakers(prefix, game);
          const series = matches.slice(index, index + expected.length);
          if (series.length !== expected.length || series.some((item, position) => item.seed !== expected[position].seed || item.round !== expected[position].round)) throw new Error("Invalid finals tiebreaker participants or play order.");
        }
      }
      prefix.push(match);
    }
    let expected = generate(teams, qualifications, initial.length * 2, game);
    const unavailable = [];
    for (const id of withdrawn) {
      expected = withdraw(teams, qualifications, expected, unavailable, id, game).matches;
      unavailable.push(id);
    }
    if (initial.some((match, index) => JSON.stringify(match.teams) !== JSON.stringify(expected[index].teams))) throw new Error("Finals alliances must follow adjacent qualification ranks and recorded withdrawals.");
    return matches;
  }

  /** @param {import("./types").Team[]} teams Current roster. @param {import("./types").Match[]} qualifications Qualification schedule/results. @param {import("./types").FinalsMatch[]} matches Current finals bracket. @param {string[]} withdrawn Previously withdrawn IDs. @param {string} teamId Team withdrawing before its alliance plays. @param {import("./types").GameDefinition} [game=Game.active] Qualification ranking rules. @returns {{matches: import("./types").FinalsMatch[], withdrawn: string[], replacement: (string|null)}} Updated bracket, withdrawal list, and replacement ID if available. */
  function withdraw(teams, qualifications, matches, withdrawn, teamId, game = Game.active) {
    const alliance = matches.find(match => match.round === 1 && match.teams.includes(teamId));
    if (!alliance || matches.some(match => match.seed === alliance.seed && match.result) || matches.some(match => match.round > 1)) throw new Error("Withdraw teams before their alliance plays and before any tiebreaker series is generated.");
    const unavailable = new Set([...withdrawn, ...matches.flatMap(match => match.teams)]);
    const replacement = eligible(teams, qualifications, game).find(team => !unavailable.has(team.id));
    const nextTeams = alliance.teams.flatMap(id => id === teamId ? replacement ? [replacement.id] : [] : [id]);
    if (!nextTeams.length) throw new Error("An alliance must retain at least one team. Resolve this withdrawal with the Event Partner.");
    return {
      matches: matches.map(match => match.seed === alliance.seed ? { ...match, teams: nextTeams } : match),
      withdrawn: [...withdrawn, teamId], replacement: replacement?.id || null
    };
  }

  const api = { eligible, generate, score, validateMatch, validate, outcome, tiebreakers, withdraw };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FinalsModel = api;
})(globalThis);

/**
 * Append-only score-history model. Resolves corrections/removals, validates
 * game-tagged results, and derives rankings, analysis, robot attribution, and CSV.
 */
(function (root) {
  "use strict";
  const Core = typeof module !== "undefined" && module.exports ? require("./event-rules.js") : root.EventRules;
  const Finals = typeof module !== "undefined" && module.exports ? require("./finals.js") : root.FinalsModel;
  const Game = Core.Game;
  const gameOf = record => Game.get(Game.of(record));
  const copy = value => JSON.parse(JSON.stringify(value));
  // Browsers only expose randomUUID in secure contexts, and Apps Script has no Web Crypto at all.
  const newId = () => {
    if (typeof root.crypto?.randomUUID === "function") return root.crypto.randomUUID();
    if (typeof root.Utilities?.getUuid === "function") return root.Utilities.getUuid();
    const bytes = new Uint8Array(16);
    if (typeof root.crypto?.getRandomValues === "function") root.crypto.getRandomValues(bytes);
    else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  /**
   * Snapshot a posted result with its team identities and originating game.
  * @param {import("./types").HistoryContext} event Event/session containing the roster and game ID.
  * @param {import("./types").HistoryKind} kind Result kind.
  * @param {unknown} value Posted result payload.
  * @param {import("./types").HistoryAction} action Audit action.
   * @param {?string} [recordedAt=now] ISO timestamp, or null for migrated records.
  * @returns {import("./types").ScoreHistoryRecord} Deep-copied history record.
   */
  function capture(event, kind, value, action, recordedAt = new Date().toISOString()) {
    const ids = kind === "teamwork" || kind === "scrimmage" ? value.teams : [value.team];
    return {
      id: newId(), sessionId: event.sessionId, eventName: event.name,
      recordedAt, action, kind, skillsOnly: event.skillsOnly, game: event.game || Game.ACTIVE_GAME_ID,
      teams: copy(event.teams.filter(team => ids.includes(team.id))),
      value: copy(value)
    };
  }

  /**
   * Validate history records through the game model that owns each record.
  * @param {import("./types").ScoreHistoryRecord[]} records Append-only records to validate.
  * @returns {import("./types").ScoreHistoryRecord[]} The same array when every record is valid.
   * @throws {Error} On duplicate IDs, invalid payloads, or game-rule mismatches.
   */
  function validate(records) {
    if (!Array.isArray(records)) throw new Error("Invalid score history.");
    const ids = new Set();
    for (const record of records) {
      if (!record || typeof record.id !== "string" || !record.id || ids.has(record.id) || typeof record.sessionId !== "string" || !record.sessionId || typeof record.eventName !== "string" || record.eventName.length > 80 || typeof record.skillsOnly !== "boolean" || !["posted", "updated", "promoted", "removed", "voided", "migrated"].includes(record.action) || (record.recordedAt !== null && (typeof record.recordedAt !== "string" || !Number.isFinite(Date.parse(record.recordedAt))))) throw new Error("Invalid score history record.");
      ids.add(record.id);
      if (record.game !== undefined && !Game.validId(record.game)) throw new Error(`Score history uses unknown game "${record.game}". Add its definition to games/ before loading this data.`);
      const game = gameOf(record);
      const maxTeams = record.kind === "scrimmage" ? 4 : 2;
      if (!Array.isArray(record.teams) || !record.teams.length || record.teams.length > maxTeams || new Set(record.teams.map(team => team?.id)).size !== record.teams.length || record.teams.some(team => !team || !/^[A-Z0-9-]{1,20}$/.test(team.id) || typeof team.name !== "string" || !team.name || team.name.length > 80)) throw new Error("Invalid score history teams.");
      const value = record.value;
      if (record.source !== undefined && !["event", "practice"].includes(record.source)) throw new Error("Invalid score source.");
      if (record.source === "practice" && (typeof record.runId !== "string" || !record.runId || record.sessionId !== `practice:${record.runId}` || typeof record.occurredAt !== "string" || !Number.isFinite(Date.parse(record.occurredAt)) || typeof record.notes !== "string" || record.notes.length > 1000)) throw new Error("Invalid practice run metadata.");
      if (record.runRole !== undefined && (record.source !== "practice" || !["coach", "member"].includes(record.runRole))) throw new Error("Invalid practice run role.");
      if (record.kind === "skills") {
        Core.validateSkills(record.teams, [value], game);
        if (value.gameData !== undefined) {
          const fieldResult = game.practice?.field?.evaluate(value.mode, value.gameData);
          if (fieldResult?.kind !== "skills" || fieldResult.counts.some((count, index) => count !== value.counts[index])) throw new Error("Practice Skills game data does not match the saved score.");
        }
        if (value.resultId !== undefined && (typeof value.resultId !== "string" || !value.resultId)) throw new Error("Invalid skills history identity.");
        if (record.teams.length !== 1) throw new Error("Invalid skills history teams.");
      } else if (record.kind === "teamwork") {
        if (value?.phase !== undefined && !["qualification", "finals"].includes(value.phase)) throw new Error("Invalid teamwork phase.");
        if (!value || !Number.isInteger(value.id) || value.id < 1 || !Number.isInteger(value.round) || value.round < 1 || !Array.isArray(value.teams) || (value.phase === "finals" ? value.teams.length < 1 || value.teams.length > 2 : value.teams.length !== 2) || new Set(value.teams).size !== value.teams.length || !value.teams.every(id => record.teams.some(team => team.id === id)) || (value.surrogate !== null && !value.teams.includes(value.surrogate)) || !value.result?.statuses || !value.teams.every(id => ["ok", "dq", "absent"].includes(value.result.statuses[id]))) throw new Error("Invalid teamwork history result.");
        if (value.phase === "finals") {
          if (record.source === "practice") throw new Error("Practice runs cannot be finals.");
          Finals.validateMatch(value, record.teams, game);
        }
        Core.validateResult(value.result, game, "Invalid history goal breakdown.");
      } else if (record.kind === "scrimmage") {
        if (record.source !== "practice" || !game.practice?.scrimmage || !value?.practiceScrimmage || !Array.isArray(value.teams) || value.teams.length !== 4 || new Set(value.teams).size !== 4 || value.teams.some(id => !record.teams.some(team => team.id === id)) || !["red", "blue"].every(color => Array.isArray(value.alliances?.[color]) && value.alliances[color].length === 2) || new Set([...value.alliances.red, ...value.alliances.blue]).size !== 4 || ![...value.alliances.red, ...value.alliances.blue].every(id => value.teams.includes(id)) || !value.gameData || !value.scores || ![value.scores.red, value.scores.blue].every(Number.isFinite)) throw new Error("Invalid practice scrimmage record.");
        const fieldResult = game.practice.field.evaluate("teamwork", value.gameData);
        if (fieldResult.kind !== "scrimmage" || fieldResult.scores.red.score !== value.scores.red || fieldResult.scores.blue.score !== value.scores.blue) throw new Error("Practice scrimmage scores do not match the saved game data.");
      } else throw new Error("Invalid score history type.");
    }
    return records;
  }

  /** @param {import("./types").EventState} event Event being initialized. @returns {import("./types").EventState} Event with session/history/Skills IDs filled in. */
  function initialize(event) {
    if (event.sessionId === undefined) event.sessionId = newId();
    if (typeof event.sessionId !== "string" || !event.sessionId) throw new Error("Invalid session identity.");
    if (event.history === undefined) {
      event.history = [
        ...[...event.matches, ...(event.finals || [])].filter(match => match.result).map(match => capture(event, "teamwork", match, "migrated", null)),
        ...event.skills.map(entry => capture(event, "skills", entry, "migrated", null))
      ];
    }
    validate(event.history);
    for (const entry of event.skills) {
      if (entry.resultId === undefined) entry.resultId = skillKey(event.sessionId, entry);
      if (typeof entry.resultId !== "string" || !entry.resultId) throw new Error("Invalid skills result identity.");
    }
    return event;
  }

  /** @param {string} sessionId Owning session ID. @param {import("./types").SkillsAttempt} entry Skills result. @returns {string} Stable team/mode/attempt key. */
  function skillKey(sessionId, entry) {
    return entry.resultId || JSON.stringify([sessionId, entry.team, entry.mode, entry.attempt]);
  }

  /** @param {import("./types").ScoreHistoryRecord} record History revision. @returns {string} Logical key shared by revisions of one result. */
  function resultKey(record) {
    return record.source === "practice" ? JSON.stringify(["practice", record.runId]) : record.kind === "teamwork"
      ? JSON.stringify(record.value.phase === "finals" ? [record.sessionId, "teamwork", "finals", record.value.id] : [record.sessionId, "teamwork", record.value.id])
      : JSON.stringify([record.sessionId, "skills", skillKey(record.sessionId, record.value)]);
  }

  // Rendering resolves the same history many times. Reuse the result while the array still holds the same records.
  const resolvedCache = new WeakMap();
  /** @param {import("./types").ScoreHistoryRecord[]} records History revisions. @returns {import("./types").ScoreHistoryRecord[]} Latest record per result, excluding removed/voided entries. */
  function resolve(records) {
    const cached = resolvedCache.get(records);
    if (cached && cached.source.length === records.length && cached.source.every((record, index) => record === records[index])) return cached.resolved.slice();
    validate(records);
    const latest = new Map();
    for (const record of ordered(records)) latest.set(resultKey(record), record);
    const resolved = [...latest.values()].filter(record => !["removed", "voided"].includes(record.action));
    resolvedCache.set(records, { source: records.slice(), resolved });
    return resolved.slice();
  }

  /** @param {import("./types").RobotVersion[]} robots Robot-version records. @returns {import("./types").RobotVersion[]} The validated array unchanged. */
  function validateRobots(robots) {
    if (!Array.isArray(robots) || robots.length > 2000) throw new Error("Invalid robot versions.");
    const ids = new Set();
    for (const robot of robots) {
      if (!robot || typeof robot.id !== "string" || !robot.id || robot.id.length > 100 || ids.has(robot.id) || !/^[A-Z0-9-]{1,20}$/.test(robot.team) || typeof robot.name !== "string" || !robot.name.trim() || robot.name.length > 60 || typeof robot.startedAt !== "string" || !Number.isFinite(Date.parse(robot.startedAt)) || typeof robot.notes !== "string" || robot.notes.length > 500 || (robot.abandonedAt !== undefined && (typeof robot.abandonedAt !== "string" || !Number.isFinite(Date.parse(robot.abandonedAt)) || Date.parse(robot.abandonedAt) < Date.parse(robot.startedAt)))) throw new Error("Invalid robot version.");
      ids.add(robot.id);
    }
    return robots;
  }

  /** @param {import("./types").RobotVersion[]} robots Valid robot versions. @param {import("./types").TeamId} teamId Team to query. @returns {import("./types").RobotVersion[]} Versions sorted oldest to newest. */
  function robotVersions(robots, teamId) {
    return robots.filter(robot => robot.team === teamId).sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt) || left.id.localeCompare(right.id));
  }

  /** @param {import("./types").RobotVersion[]} robots Robot-version records. @param {import("./types").TeamId} teamId Team to query. @returns {?import("./types").RobotVersion} Latest active version, or null. */
  function currentRobot(robots, teamId) {
    const versions = robotVersions(robots, teamId).filter(robot => robot.abandonedAt === undefined);
    return versions[versions.length - 1] || null;
  }

  /** @param {import("./types").RobotVersion[]} robots Current robot versions. @param {string} robotId Version to abandon. @param {string} [abandonedAt=now] Effective abandonment time. @returns {import("./types").RobotVersion[]} New validated robot array. */
  function abandonRobot(robots, robotId, abandonedAt = new Date().toISOString()) {
    const robot = robots.find(item => item.id === robotId);
    if (!robot) throw new Error("This robot version no longer exists. Reload the latest data.");
    const time = new Date(Math.max(Date.parse(abandonedAt), Date.parse(robot.startedAt))).toISOString();
    return validateRobots(robots.map(item => item.id === robotId ? { ...item, abandonedAt: time } : item));
  }

  /** @param {import("./types").RobotVersion[]} robots Current robot versions. @param {string} robotId Version to restore. @returns {import("./types").RobotVersion[]} New validated array with the version active. */
  function restoreRobot(robots, robotId) {
    return validateRobots(robots.map(item => {
      if (item.id !== robotId) return item;
      const { abandonedAt, ...restored } = item;
      return restored;
    }));
  }

  // Results belong to the robot in use when the score was first posted (or the entered practice run time),
  // so later corrections do not move an older result onto a newer robot. An abandoned robot keeps the
  // results from its start until it was abandoned; later results return to the previous robot.
  /** @param {import("./types").ScoreHistoryRecord[]} records Score history. @param {import("./types").RobotVersion[]} robots Version timeline. @returns {(record: import("./types").ScoreHistoryRecord, teamId: import("./types").TeamId) => string|null} Resolver for a record/team pair. */
  function robotAttribution(records, robots) {
    validateRobots(robots);
    const firstPosted = new Map();
    for (const record of ordered(records)) {
      const key = resultKey(record);
      if (record.recordedAt !== null && !firstPosted.has(key)) firstPosted.set(key, record.recordedAt);
    }
    const versions = new Map();
    return (record, teamId) => {
      if (!versions.has(teamId)) versions.set(teamId, robotVersions(robots, teamId));
      const date = record.source === "practice" ? record.occurredAt : firstPosted.get(resultKey(record)) ?? null;
      if (date === null) return null;
      const time = Date.parse(date);
      const used = versions.get(teamId).filter(robot => Date.parse(robot.startedAt) <= time && (robot.abandonedAt === undefined || time < Date.parse(robot.abandonedAt)));
      return used.length ? used[used.length - 1].id : null;
    };
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records Score history. @param {import("./types").RobotVersion[]} robots Version timeline. @returns {(record: import("./types").ScoreHistoryRecord, teamId: import("./types").TeamId) => boolean} Predicate selecting only results attributed to each team's current robot. */
  function currentRobotOnly(records, robots) {
    const robotOf = robotAttribution(records, robots);
    const current = new Map();
    return (record, teamId) => {
      if (!current.has(teamId)) current.set(teamId, currentRobot(robots, teamId)?.id ?? null);
      return robotOf(record, teamId) === current.get(teamId);
    };
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records Score history. @param {import("./types").RobotVersion[]} robots Version timeline. @param {import("./types").TeamId} teamId Team to compare. @returns {Array<import("./types").RobotVersion & {current: boolean, modes: Record<string, unknown>, skillsBest: number|null}>} Per-version summaries, including the original robot. */
  function robotComparison(records, robots, teamId) {
    const robotOf = robotAttribution(records, robots);
    const versions = [{ id: null, name: "Original robot", startedAt: null, notes: "" }, ...robotVersions(robots, teamId)];
    const current = currentRobot(robots, teamId)?.id ?? null;
    return versions.map(version => {
      const { modes } = teamAnalysis(records, teamId, record => robotOf(record, teamId) === version.id);
      const driver = modes.driver.best ?? 0;
      const autonomous = modes.autonomous.best ?? 0;
      return { ...version, current: version.id === current, modes, skillsBest: modes.driver.count || modes.autonomous.count ? driver + autonomous : null };
          }).filter(row => row.id !== null || row.current || Object.values(row.modes).some(stats => stats.count));
  }

  function renameRobots(robots, from, to) {
    return robots.map(robot => robot.team === from ? { ...robot, team: to } : robot);
  }

  function filterSource(records, source = "all") {
    if (!["all", "event", "practice"].includes(source)) throw new Error("Invalid analysis source.");
    return records.filter(record => source === "all" || (record.source || "event") === source);
  }

  function teamScore(match, id, game = Game.active) {
    return match.result.statuses[id] === "ok" ? match.phase === "finals" ? Finals.score(match, game) : Core.score(match.result.counts, game) : 0;
  }

  /**
   * Create or correct a practice history record; gameData remains game-owned and opaque here.
  * @param {import("./types").ScoreHistoryRecord[]} records Existing history revisions.
  * @param {import("./types").Team[]} teams Current roster.
  * @param {import("./types").PracticeRunInput} input Common run metadata, participants, and optional gameData.
   * @param {?string} [runId=null] Existing run to correct, or null to create a run.
  * @param {import("./types").GameDefinition} [game=Game.active] Rules for the saved record.
  * @returns {import("./types").ScoreHistoryRecord} New immutable history revision.
   */
  function practiceRecord(records, teams, input, runId = null, game = Game.active) {
    validate(records);
    const previous = runId === null ? null : resolve(records).find(record => record.source === "practice" && record.runId === runId);
    if (runId !== null && !previous) throw new Error("This practice run no longer exists. Reload the latest data.");
    const scrimmage = Boolean(input?.scrimmage);
    const expectedTeams = input?.mode === "teamwork" ? scrimmage ? 4 : 2 : 1;
    if (!input || !["teamwork", "driver", "autonomous"].includes(input.mode) || !Array.isArray(input.teams) || input.teams.length !== expectedTeams || new Set(input.teams).size !== input.teams.length || !input.teams.every(id => teams.some(team => team.id === id)) || (scrimmage && (!game.practice?.scrimmage || input.mode !== "teamwork" || !Array.isArray(input.redTeams) || input.redTeams.length !== 2 || !Array.isArray(input.blueTeams) || input.blueTeams.length !== 2 || new Set([...input.redTeams, ...input.blueTeams]).size !== 4 || ![...input.redTeams, ...input.blueTeams].every(id => input.teams.includes(id))))) throw new Error("Choose registered, distinct teams for this practice run.");
    if (typeof input.occurredAt !== "string" || !Number.isFinite(Date.parse(input.occurredAt)) || typeof input.notes !== "string" || input.notes.length > 1000) throw new Error("Enter a valid run date/time and notes of at most 1000 characters.");
    const fieldResult = input.gameData === undefined ? null : game.practice?.field?.evaluate(input.mode, input.gameData);
    if (input.gameData !== undefined && !fieldResult) throw new Error("This game does not support custom practice data.");
    if (scrimmage && fieldResult?.kind !== "scrimmage") throw new Error("The game's practice field does not support this scrimmage mode.");
    const counts = scrimmage ? null : Core.goalCounts(input.goals, game);
    if (fieldResult?.kind === "skills" && fieldResult.counts.some((count, index) => count !== counts[index])) throw new Error("Practice Skills game data does not match the saved score.");
    const id = previous ? previous.runId : newId();
    const event = { teams, sessionId: `practice:${id}`, name: "Practice", skillsOnly: true, game: game.id };
    const kind = scrimmage ? "scrimmage" : input.mode === "teamwork" ? "teamwork" : "skills";
    const value = scrimmage
      ? { practiceScrimmage: true, teams: [...input.teams], alliances: { red: [...input.redTeams], blue: [...input.blueTeams] }, gameData: copy(input.gameData), scores: { red: fieldResult.scores.red.score, blue: fieldResult.scores.blue.score } }
      : kind === "teamwork" ? { id: 1, round: 1, teams: [...input.teams], surrogate: null, result: { counts, goals: copy(input.goals), statuses: copy(input.statuses) } }
      : { team: input.teams[0], mode: input.mode, attempt: 1, resultId: id, counts, goals: copy(input.goals), ...(input.gameData === undefined ? {} : { gameData: copy(input.gameData) }), status: input.status, optIn: input.optIn, stopTime: input.stopTime };
    const record = { ...capture(event, kind, value, previous ? "updated" : "posted"), source: "practice", runRole: previous ? previous.runRole || "coach" : input.runRole === undefined ? "coach" : input.runRole, runId: id, occurredAt: input.occurredAt, notes: input.notes };
    validate([record]);
    return record;
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records Resolved history revisions. @param {string} runId Practice run to remove. @returns {import("./types").ScoreHistoryRecord} New audit revision marked removed. */
  function removePractice(records, runId) {
    const previous = resolve(records).find(record => record.source === "practice" && record.runId === runId);
    if (!previous) throw new Error("This practice run no longer exists. Reload the latest data.");
    return { ...copy(previous), id: newId(), recordedAt: new Date().toISOString(), action: "removed" };
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records Resolved history revisions. @param {string} runId Student practice run to promote. @returns {import("./types").ScoreHistoryRecord} New coach revision; the student record remains in history. */
  function promotePractice(records, runId) {
    const previous = resolve(records).find(record => record.source === "practice" && record.runId === runId);
    if (!previous) throw new Error("This practice run no longer exists. Reload the latest data.");
    if (previous.runRole !== "member") throw new Error("Only student practice runs can be promoted.");
    const previousTime = Date.parse(previous.recordedAt);
    const recordedAt = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : Date.now())).toISOString();
    const promoted = { ...copy(previous), id: newId(), recordedAt, action: "promoted", runRole: "coach" };
    validate([promoted]);
    return promoted;
  }

  /** @param {number[]} values Numeric scores. @returns {{count: number, average: ?number, median: ?number, best: ?number, deviation: ?number}} Population statistics; numeric values are null when empty. */
  function statistics(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    if (!count) return { count: 0, average: null, median: null, best: null, deviation: null };
    const average = values.reduce((sum, value) => sum + value, 0) / count;
    return { count, average, median: (sorted[Math.floor((count - 1) / 2)] + sorted[Math.floor(count / 2)]) / 2, best: sorted[count - 1], deviation: Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / count) };
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records History revisions. @returns {import("./types").HistoryAnalysis} Resolved records and grouped all-time summaries. */
  function analyze(records) {
    const resolved = resolve(records);
    const groups = new Map();
    const add = (scope, type, value) => {
      const key = JSON.stringify([scope, type]);
      if (!groups.has(key)) groups.set(key, { scope, type, values: [] });
      groups.get(key).values.push(value);
    };
    for (const record of resolved) {
      if (record.kind === "teamwork") {
        const match = record.value;
        const total = Core.score(match.result.counts, gameOf(record));
        add("All alliances (shared score)", "Teamwork", total);
        for (const id of match.teams.filter(id => id !== match.surrogate)) add(id, "Teamwork (shared score)", teamScore(match, id, gameOf(record)));
      } else {
        const entry = record.value;
        const total = entry.status === "ok" ? Core.score(entry.counts, gameOf(record)) : 0;
        const type = entry.mode === "driver" ? "Driver skills" : "Autonomous skills";
        add("All teams", type, total);
        add(entry.team, type, total);
      }
    }
    return { resolved, rows: [...groups.values()].map(({ scope, type, values }) => ({ scope, type, ...statistics(values) })) };
  }

  function ordered(records) {
    return records.map((record, index) => ({ record, index, time: record.recordedAt === null ? -Infinity : Date.parse(record.recordedAt) }))
      .sort((left, right) => left.time - right.time || left.index - right.index).map(entry => entry.record);
  }

  const byTeam = (records, teamsOf) => {
    const groups = new Map();
    for (const record of records) for (const id of teamsOf(record)) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(record);
    }
    return id => groups.get(id) || [];
  };

  /** @param {import("./types").ScoreHistoryRecord[]} records History revisions. @param {import("./types").Team[]} teams Current roster, preferred for current names. @returns {Pick<import("./types").Team, "id"|"name">[]} Deduplicated team directory. */
  function teamDirectory(records, teams) {
    const directory = new Map();
    for (const record of ordered(records)) {
      for (const team of record.teams) directory.set(team.id, { id: team.id, name: team.name });
    }
    for (const team of teams) directory.set(team.id, { id: team.id, name: team.name });
    return [...directory.values()];
  }

  /** @param {?string} value ISO timestamp or null. @returns {string} Local calendar date, or "Unknown". */
  function localDate(value) {
    if (value === null) return "Unknown";
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  /** @param {?string} value ISO timestamp or null. @returns {string} Localized date and time, or "Unknown". */
  function localDateTime(value) {
    return value === null ? "Unknown" : new Date(value).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "numeric",       minute: "2-digit", hour12: true, timeZoneName: "short"
    });
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records Candidate results. @param {(record: import("./types").ScoreHistoryRecord) => number} score Selects each record's score. @param {number} best Score whose date is requested. @returns {string} Earliest matching local date, "Unknown", or "--". */
  function bestScoreDate(records, score, best) {
    const tied = records.filter(record => score(record) === best);
    if (!tied.length) return "--";
    const dates = tied.map(record => record.source === "practice" ? record.occurredAt : record.recordedAt).filter(value => value !== null);
    if (!dates.length) return "Unknown";
    return localDate(Math.min(...dates.map(value => Date.parse(value))));
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records History revisions. @param {import("./types").Team[]} [teams=[]] Extra roster rows. @param {(record: import("./types").ScoreHistoryRecord, teamId: import("./types").TeamId) => boolean} [include] Record filter. @returns {import("./types").TeamworkRankingRow[]} Per-team best Teamwork scores and ranks. */
  function teamworkRanking(records, teams = [], include = () => true) {
    const forTeam = byTeam(resolve(records).filter(record => record.kind === "teamwork" && record.runRole !== "member"), record => new Set(record.value.teams));
    const rows = teamDirectory(records, teams).map(team => {
      const matches = forTeam(team.id).filter(record => include(record, team.id));
      const best = matches.length ? Math.max(...matches.map(record => teamScore(record.value, team.id, gameOf(record)))) : null;
      const bestDate = bestScoreDate(matches, record => teamScore(record.value, team.id, gameOf(record)), best);
      return { ...team, best, bestDate, played: matches.length, rank: null };
    });
    rows.sort((a, b) => Number(b.played > 0) - Number(a.played > 0) || b.best - a.best || a.id.localeCompare(b.id, "en", { numeric: true }));
    let previous;
    rows.forEach((row, index) => {
      if (!row.played) return;
      row.rank = previous && previous.best === row.best ? previous.rank : index + 1;
      previous = row;
    });
    return rows;
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records History revisions. @param {import("./types").Team[]} [teams=[]] Extra roster rows. @param {(record: import("./types").ScoreHistoryRecord, teamId: import("./types").TeamId) => boolean} [include] Record filter. @returns {import("./types").SkillsRankingRow[]} Per-team Driver/Autonomous bests, dates, totals, and ranks. */
  function skillsRanking(records, teams = [], include = () => true) {
    const forTeam = byTeam(resolve(records).filter(record => record.kind === "skills" && record.runRole !== "member"), record => [record.value.team]);
    const rows = teamDirectory(records, teams).map(team => {
      const attempts = forTeam(team.id).filter(record => include(record, team.id));
      const best = mode => Math.max(0, ...attempts.filter(record => record.value.mode === mode).map(record => record.value.status === "ok" ? Core.score(record.value.counts, gameOf(record)) : 0));
      const driver = best("driver");
      const autonomous = best("autonomous");
      const date = mode => bestScoreDate(attempts.filter(record => record.value.mode === mode), record => record.value.status === "ok" ? Core.score(record.value.counts, gameOf(record)) : 0, mode === "driver" ? driver : autonomous);
      return { ...team, driver, autonomous, driverDate: date("driver"), autonomousDate: date("autonomous"), total: driver + autonomous, entered: attempts.length > 0, rank: null };
    });
    rows.sort((left, right) => Number(right.entered) - Number(left.entered) || right.total - left.total || left.id.localeCompare(right.id, "en", { numeric: true }));
    let previous;
    rows.forEach((row, index) => {
      if (!row.entered) return;
      row.rank = previous && previous.total === row.total ? previous.rank : index + 1;
      previous = row;
    });
    return rows;
  }

  /** @param {import("./types").ScoreHistoryRecord[]} existing Local history. @param {import("./types").ScoreHistoryRecord[]} incoming Backup/shared history. @returns {import("./types").ScoreHistoryRecord[]} Chronologically ordered union; conflicting duplicate IDs throw. */
  function merge(existing, incoming) {
    validate(existing);
    validate(incoming);
    const records = new Map(existing.map(record => [record.id, record]));
    for (const record of incoming) {
      if (records.has(record.id) && JSON.stringify(records.get(record.id)) !== JSON.stringify(record)) throw new Error("Conflicting score history records in backup.");
      records.set(record.id, record);
    }
    return ordered([...records.values()]);
  }

  function solveRatings(equations, teamIds, valueKey) {
    const size = teamIds.length;
    if (!size || equations.length < size) return null;
    const indices = new Map(teamIds.map((id, index) => [id, index]));
    const matrix = Array.from({ length: size }, () => Array(size + 1).fill(0));
    for (const equation of equations) {
      const active = equation.teams.map(id => indices.get(id));
      for (const row of active) {
        for (const column of active) matrix[row][column] += 1;
        matrix[row][size] += equation[valueKey];
      }
    }
    const tolerance = Math.max(1, ...matrix.flatMap(row => row.slice(0, size).map(Math.abs))) * 1e-10;
    for (let column = 0; column < size; column++) {
      let pivot = column;
      for (let row = column + 1; row < size; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
      if (Math.abs(matrix[pivot][column]) <= tolerance) return null;
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
      const divisor = matrix[column][column];
      for (let index = column; index <= size; index++) matrix[column][index] /= divisor;
      for (let row = 0; row < size; row++) {
        if (row === column) continue;
        const factor = matrix[row][column];
        for (let index = column; index <= size; index++) matrix[row][index] -= factor * matrix[column][index];
      }
    }
    return Object.fromEntries(teamIds.map((id, index) => [id, matrix[index][size]]));
  }

  /** @param {import("./types").ScoreHistoryRecord[]} records History revisions. @param {import("./types").TeamId} teamId Team to analyze. @param {(record: import("./types").ScoreHistoryRecord, teamId: import("./types").TeamId) => boolean} [include] Record filter. @returns {Record<string, unknown>} Per-mode trends, partners, robot-independent team metrics, and practice-scrimmage estimates. */
  function teamAnalysis(records, teamId, include = () => true) {
    const groups = { teamwork: [], driver: [], autonomous: [] };
    const partners = new Map();
    const scrimmages = [];
    const ratingRecords = [];
    for (const record of ordered(resolve(records))) {
      if (record.kind === "scrimmage") {
        const included = include(record, teamId);
        if (included) ratingRecords.push(record);
        if (!record.value.teams.includes(teamId) || !included) continue;
        const color = record.value.alliances.red.includes(teamId) ? "red" : "blue";
        const opponent = color === "red" ? "blue" : "red";
        const score = record.value.scores[color];
        const opponentScore = record.value.scores[opponent];
        const outcome = score > opponentScore ? "win" : score < opponentScore ? "loss" : "tie";
        const alliance = record.value.alliances[color];
        const partner = alliance.find(id => id !== teamId);
        const practiceResult = gameOf(record).practice.field.evaluate("teamwork", record.value.gameData);
        const entry = {
          recordId: record.id, sessionId: record.sessionId, eventName: record.eventName,
          recordedAt: record.occurredAt, label: "Practice scrimmage", status: "ok",
          score, fieldScore: score, opponentScore, scoreDifferential: score - opponentScore,
          outcome, wp: outcome === "win" ? 2 : outcome === "tie" ? 1 : 0,
          ap: practiceResult.autonomousBonus[color], partner
        };
        groups.teamwork.push(entry);
        scrimmages.push({ record, entry });
        if (!partners.has(partner)) partners.set(partner, { id: partner, name: record.teams.find(team => team.id === partner).name, entries: [] });
        partners.get(partner).entries.push(entry);
      } else if (record.kind === "teamwork") {
        const match = record.value;
        if (!match.teams.includes(teamId) || !include(record, teamId)) continue;
        const partner = match.teams.find(id => id !== teamId);
        const status = match.result.statuses[teamId];
        const fieldScore = Core.score(match.result.counts, gameOf(record));
        const entry = { recordId: record.id, sessionId: record.sessionId, eventName: record.eventName, recordedAt: record.source === "practice" ? record.occurredAt : record.recordedAt, label: record.source === "practice" ? record.runRole === "member" ? "Student practice (not ranked)" : "Coach practice" : `${match.phase === "finals" ? "F" : "Q"}${match.id}`, status, score: teamScore(match, teamId, gameOf(record)), fieldScore, surrogate: match.surrogate === teamId, partner };
        groups.teamwork.push(entry);
        if (!partner) continue;
        if (!partners.has(partner)) partners.set(partner, { id: partner, name: record.teams.find(team => team.id === partner).name, entries: [] });
        partners.get(partner).entries.push(entry);
      } else if (record.value.team === teamId && include(record, teamId)) {
        const entry = record.value;
        groups[entry.mode].push({ recordId: record.id, sessionId: record.sessionId, eventName: record.eventName, recordedAt: record.source === "practice" ? record.occurredAt : record.recordedAt, label: record.source === "practice" ? record.runRole === "member" ? "Student practice (not ranked)" : "Coach practice" : `Attempt ${entry.attempt}`, status: entry.status, score: entry.status === "ok" ? Core.score(entry.counts, gameOf(record)) : 0 });
      }
    }
    const summarize = entries => {
      const timed = ordered(entries.filter(entry => entry.recordedAt !== null));
      const recent = timed.slice(-5);
      const previous = timed.slice(Math.max(0, timed.length - recent.length - 5), timed.length - recent.length);
      const recentAverage = statistics(recent.map(entry => entry.score)).average;
      const previousAverage = statistics(previous.map(entry => entry.score)).average;
      const best = statistics(entries.map(entry => entry.score)).best;
      const bestDates = timed.filter(entry => entry.score === best);
      const bestDate = best === null ? "--" : bestDates.length ? localDate(bestDates[0].recordedAt) : "Unknown";
      const rolling = timed.map((entry, index) => ({
        ...entry, rollingAverage: statistics(timed.slice(Math.max(0, index - 4), index + 1).map(item => item.score)).average,
        rollingCount: Math.min(5, index + 1)
      }));
      return {
        ...statistics(entries.map(entry => entry.score)), entries,
        dq: entries.filter(entry => entry.status === "dq").length,
        absent: entries.filter(entry => entry.status === "absent").length,
        forfeit: entries.filter(entry => entry.status === "forfeit").length,
        surrogate: entries.filter(entry => entry.surrogate).length,
        timed, unknownDates: entries.length - timed.length, recentCount: recent.length, previousCount: previous.length,
        recentAverage, previousAverage, change: previousAverage === null ? null : recentAverage - previousAverage,
        recentBest: statistics(recent.map(entry => entry.score)).best, bestDate, rolling
      };
    };
    const equations = ratingRecords.flatMap(record => ["red", "blue"].map(color => ({
      teams: record.value.alliances[color],
      score: record.value.scores[color],
      opponentScore: record.value.scores[color === "red" ? "blue" : "red"]
    })));
    const component = new Set([teamId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const equation of equations) {
        if (!equation.teams.some(id => component.has(id))) continue;
        for (const id of equation.teams) if (!component.has(id)) { component.add(id); expanded = true; }
      }
    }
    const teamIds = [...component].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const componentEquations = equations.filter(equation => equation.teams.every(id => component.has(id)));
    const opr = solveRatings(componentEquations, teamIds, "score");
    const dpr = solveRatings(componentEquations, teamIds, "opponentScore");
    const entries = scrimmages.map(({ entry }) => entry);
    const teamScrimmage = {
      matches: entries.length,
      wins: entries.filter(entry => entry.outcome === "win").length,
      ties: entries.filter(entry => entry.outcome === "tie").length,
      losses: entries.filter(entry => entry.outcome === "loss").length,
      wp: entries.reduce((sum, entry) => sum + entry.wp, 0),
      ap: entries.reduce((sum, entry) => sum + entry.ap, 0),
      sp: entries.reduce((sum, entry) => sum + entry.opponentScore, 0),
      scoreFor: statistics(entries.map(entry => entry.score)),
      scoreAgainst: statistics(entries.map(entry => entry.opponentScore)),
      scoreDifferential: statistics(entries.map(entry => entry.scoreDifferential)),
      opr: opr?.[teamId] ?? null,
      dpr: dpr?.[teamId] ?? null,
      ccwm: opr && dpr ? opr[teamId] - dpr[teamId] : null,
      entries
    };
    return {
      modes: Object.fromEntries(Object.entries(groups).map(([mode, entries]) => [mode, summarize(entries)])),
      scrimmage: teamScrimmage,
      partners: [...partners.values()].map(partner => ({
        id: partner.id, name: partner.name, ...summarize(partner.entries),
        fieldAverage: statistics(partner.entries.map(entry => entry.fieldScore)).average,
        fieldBest: statistics(partner.entries.map(entry => entry.fieldScore)).best
      })).sort((a, b) => b.average - a.average || b.count - a.count || a.id.localeCompare(b.id))
    };
  }

  // Exports one game at a time because each game's scoring breakdown has different columns.
  /** @param {import("./types").ScoreHistoryRecord[]} records History revisions to export. @param {import("./types").RobotVersion[]} [robots=[]] Robot versions for attribution. @param {import("./types").ScoreHistoryRecord[]} [allRecords=records] Full history used to find original post times. @param {import("./types").GameDefinition} [game=Game.active] Game whose CSV columns are used. @returns {string} Formula-safe CSV for this game's results. */
  function csv(records, robots = [], allRecords = records, game = Game.active) {
    validate(records);
    records = Game.forGame(records, game.id);
    const robotOf = robotAttribution(allRecords, robots);
    const robotName = (record, id) => {
      const version = robotOf(record, id);
      if (version === null) return "Original robot";
      const robot = robots.find(item => item.id === version);
      return robot.abandonedAt === undefined ? robot.name : `${robot.name} (abandoned)`;
    };
    const headers = ["Record ID", "Session ID", "Event", "Recorded at (UTC)", "Action", "Type", "Match", "Round", "Mode", "Attempt", "Team", "Team name", "Partner", "Surrogate", "Status", "Field score", "Team score", ...game.csv.headers, "Stop time opt-in", "Stop time seconds", "Skills-only event"];
    const rows = records.flatMap(record => {
      const match = record.kind === "teamwork" ? record.value : null;
      const result = match ? match.result : record.value;
      return (match ? match.teams : [result.team]).map(id => {
        const status = match ? result.statuses[id] : result.status;
        const total = Core.score(result.counts, game);
        return [record.id, record.sessionId, record.eventName, record.recordedAt ?? "", record.action, record.kind, match?.id ?? "", match?.round ?? "", match ? "" : result.mode, match ? "" : result.attempt, id, record.teams.find(team => team.id === id).name, match ? match.teams.find(team => team !== id) || "" : "", match ? match.surrogate === id : "", status, total, match ? teamScore(match, id, game) : status === "ok" ? total : 0, ...game.csv.values(result), match ? "" : result.optIn, match ? match.phase === "finals" ? result.stopTime : "" : result.stopTime, record.skillsOnly, record.source || "event", record.runId || "", record.occurredAt || "", record.notes || "", match ? record.source === "practice" ? "practice" : match.phase || "qualification" : "", match?.seed ?? "", robotName(record, id), `${game.name} ${game.season}`, record.source === "practice" ? record.runRole || "coach" : ""];
      });
    });
    const cell = value => {
      const text = String(value);
      return `"${(/^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" : "") + text.replace(/"/g, '""')}"`;
    };
    headers.push("Source", "Practice run ID", "Run time (UTC)", "Notes", "Match phase", "Finals alliance seed", "Robot version", "Game", "Practice run role");
    return [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
  }

  const api = { gameOf, forGame: Game.forGame, newId, teamDirectory, capture, validate, initialize, merge, csv, skillKey, resultKey, resolve, statistics, analyze, skillsRanking, teamworkRanking, teamAnalysis, filterSource, practiceRecord, promotePractice, removePractice, localDate, localDateTime, validateRobots, robotVersions, currentRobot, robotAttribution, currentRobotOnly, robotComparison, renameRobots, abandonRobot, restoreRobot };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScoreHistory = api;
})(globalThis);

/** Notebook and interview review schemas, validation, history, and score projection. */
(function (root) {
  "use strict";
  const Game = typeof module !== "undefined" && module.exports ? require("./game.js") : root.VexGame;
  // Each saved review is kept separately, so a team builds a dated review history per game (season).
  // Reviews saved before review history existed get a stable ID so backups from either version merge cleanly.
  const legacyId = entry => `legacy:${Game.of(entry)}|${entry.team.id}`;
  const historyModel = () => typeof module !== "undefined" && module.exports ? require("./history.js") : root.ScoreHistory;
  const notebookCriteria = [
    { id: "navigation", section: "Notebook organization", title: "Information is easy to reference", prompt: "Review how easily a reader can navigate to a particular entry." },
    { id: "contributors", section: "Notebook organization", title: "Contributors are identifiable", prompt: "Check whether the notebook identifies the team and the students responsible for entries." },
    { id: "season", section: "Notebook organization", title: "Record spans the season", prompt: "Review the distribution and consistency of dated entries across the season." },
    { id: "sources", section: "Notebook organization", title: "Outside sources are credited", prompt: "Check how outside contributions are credited alongside the work that uses them." },
    { id: "constraints", section: "Define", title: "Criteria and constraints are defined", prompt: "Review the challenge definition and the limits a successful solution must satisfy." },
    { id: "strategy", section: "Define", title: "Game strategy is documented", prompt: "Look for the reasoning and tradeoffs behind scoring priorities." },
    { id: "brainstorm", section: "Define", title: "Brainstorming is documented", prompt: "Review the range of candidate approaches and how they are compared." },
    { id: "prototypes", section: "Develop solutions", title: "Prototypes are documented", prompt: "Trace the progression between successive prototypes." },
    { id: "procedures", section: "Develop solutions", title: "Test procedures are defined", prompt: "Consider whether another person could repeat the team's tests." },
    { id: "data", section: "Develop solutions", title: "Data is collected", prompt: "Review the observations and measurements recorded for making decisions." },
    { id: "decisions", section: "Develop solutions", title: "Decisions are explained with evidence", prompt: "Look for a connection between choices, supporting evidence, and the people involved." },
    { id: "mechanisms", section: "Optimize", title: "Mechanisms are documented", prompt: "Review how visual and written explanations communicate the built mechanism." },
    { id: "code", section: "Optimize", title: "Code is documented", prompt: "Consider how the notebook explains software intent and development." },
    { id: "changes", section: "Optimize", title: "Changes are traceable to results", prompt: "Trace robot and software revisions back to testing evidence." },
    { id: "reflection", section: "Reflection and iteration", title: "Reflection appears throughout", prompt: "Look for evaluation of progress that informs subsequent work." },
    { id: "iteration", section: "Reflection and iteration", title: "Iteration is visible in sequence", prompt: "Trace repeated design cycles across building, strategy, and programming." }
  ];
  const text = (value, limit) => typeof value === "string" && value.length <= limit;
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

  /** @param {import("./types").RubricCriterion[]} criteria Ordered criteria. @param {number} minimum Lowest allowed score. @param {number} maximum Highest allowed score. @param {string} label Kind used in errors. @returns {object} Validation, history, projection, and export functions for one rubric. */
  function createRubric(criteria, minimum, maximum, label) {
  const version = "v2.0";
  /** @param {import("./types").ReviewEvaluation[]} evaluations Review history. @returns {import("./types").ReviewEvaluation[]} Validated records with supported legacy defaults filled in. */
  function validate(evaluations) {
    if (!Array.isArray(evaluations) || evaluations.length > 20000) throw new Error(`Invalid ${label} evaluations.`);
    const ids = new Set();
    for (const entry of evaluations) {
      if (!entry || entry.version !== version || !entry.team || !/^[A-Z0-9-]{1,20}$/.test(entry.team.id) || !text(entry.team.name, 80) || !entry.team.name || (entry.game !== undefined && !Game.validId(entry.game))) throw new Error(`Invalid ${label} evaluation team.`);
      if (entry.id === undefined) entry.id = legacyId(entry);
      if (typeof entry.id !== "string" || !entry.id || entry.id.length > 100 || ids.has(entry.id)) throw new Error(`Invalid or duplicate ${label} review.`);
      ids.add(entry.id);
      if (entry.reviewRole !== undefined && !["coach", "member"].includes(entry.reviewRole)) throw new Error(`Invalid ${label} review role.`);
      if (entry.authorEmail !== undefined && !text(entry.authorEmail, 254)) throw new Error(`Invalid ${label} review author.`);
      if (entry.reviewRole === "member" && typeof entry.authorEmail !== "string") throw new Error(`Missing ${label} review author.`);
      if (!date(entry.evaluatedOn) || !text(entry.updatedAt, 40) || !Number.isFinite(Date.parse(entry.updatedAt)) || !text(entry.reviewer, 80) || !text(entry.overallNotes, 4000)) throw new Error(`Invalid ${label} evaluation details.`);
      if (entry.createdAt === undefined) entry.createdAt = entry.updatedAt;
      if (!text(entry.createdAt, 40) || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error(`Invalid ${label} evaluation details.`);
      for (const field of ["scores", "notes"]) {
        if (!entry[field] || typeof entry[field] !== "object" || Array.isArray(entry[field]) || Object.keys(entry[field]).length !== criteria.length || Object.keys(entry[field]).some(id => !criteria.some(criterion => criterion.id === id))) throw new Error(`Invalid ${label} evaluation criteria.`);
      }
      for (const { id } of criteria) {
        if (entry.scores[id] !== null && (!Number.isInteger(entry.scores[id]) || entry.scores[id] < minimum || entry.scores[id] > maximum)) throw new Error(`${label} scores must be whole numbers from ${minimum} to ${maximum}, or left unscored.`);
        if (!text(entry.notes[id], 2000)) throw new Error(`${label} criterion notes must be at most 2000 characters.`);
      }
    }
    return evaluations;
  }

  /** @param {import("./types").ReviewEvaluation} entry One review. @returns {import("./types").ReviewSummary} Assessed total, count, and rubric maximum. */
  function summary(entry) {
    validate([entry]);
    const values = criteria.map(({ id }) => entry.scores[id]).filter(value => value !== null);
    return { total: values.reduce((sum, score) => sum + score, 0), scored: values.length, maximum: criteria.length * maximum };
  }

  // Review date first; reviews on the same date keep the order they were first saved, even after later edits.
  const chronological = (a, b) => a.evaluatedOn.localeCompare(b.evaluatedOn) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);

  /** @param {import("./types").ReviewEvaluation[]} evaluations Review history. @param {import("./types").TeamId} teamId Team to query. @returns {import("./types").ReviewEvaluation[]} Team reviews sorted by evaluation/creation time. */
  function reviews(evaluations, teamId) {
    return evaluations.filter(entry => entry.team.id === teamId).sort(chronological);
  }

  // Current coach result: student reviews never replace coach scores or reference notes.
  // Each criterion uses its latest assessed coach score and latest nonblank coach note.
  /** @param {import("./types").ReviewEvaluation[]} evaluations Review history. @param {import("./types").TeamId} teamId Team to query. @param {?string} [excludeId=null] Review omitted during editing. @returns {?import("./types").CurrentReview} Latest coach score/note per criterion, or null if unreviewed. */
  function current(evaluations, teamId, excludeId = null) {
    const history = reviews(evaluations, teamId).filter(entry => entry.id !== excludeId && entry.reviewRole !== "member");
    if (!history.length) return null;
    const result = Object.fromEntries(criteria.map(({ id }) => [id, { score: null, scoredOn: null, note: "", notedOn: null }]));
    for (const entry of history) {
      for (const { id } of criteria) {
        if (entry.scores[id] !== null) Object.assign(result[id], { score: entry.scores[id], scoredOn: entry.evaluatedOn });
        if (entry.notes[id].trim()) Object.assign(result[id], { note: entry.notes[id], notedOn: entry.evaluatedOn });
      }
    }
    const values = criteria.map(({ id }) => result[id].score).filter(value => value !== null);
    return { criteria: result, total: values.reduce((sum, score) => sum + score, 0), scored: values.length, maximum: criteria.length * maximum, reviews: history.length, latest: history[history.length - 1] };
  }

  /** @param {import("./types").ReviewEvaluation[]} evaluations Existing history. @param {Pick<import("./types").Team, "id"|"name">} team Team identity snapshot. @param {import("./types").ReviewInput} input Review fields. @param {?string} [reviewId=null] Existing review to replace. @param {string} [gameId=Game.ACTIVE_GAME_ID] Game tag for a new review. @returns {import("./types").ReviewEvaluation[]} New history array containing a copied review. */
  function save(evaluations, team, input, reviewId = null, gameId = Game.ACTIVE_GAME_ID) {
    validate(evaluations);
    const previous = reviewId === null ? null : evaluations.find(entry => entry.id === reviewId);
    if (reviewId !== null && !previous) throw new Error(`This ${label} review no longer exists. Reload the latest data.`);
    const now = new Date().toISOString();
    const entry = { ...input, reviewRole: previous ? previous.reviewRole || "coach" : input.reviewRole || "coach", authorEmail: previous ? previous.authorEmail || "" : input.authorEmail || "", version, id: previous ? previous.id : historyModel().newId(), team: { id: team.id, name: team.name }, game: previous ? Game.of(previous) : gameId, createdAt: previous ? previous.createdAt : now, updatedAt: now };
    validate([entry]);
    if (!criteria.some(({ id }) => entry.scores[id] !== null || entry.notes[id].trim()) && !entry.overallNotes.trim()) throw new Error(`Score or comment on at least one criterion before saving this ${label} review.`);
    const copy = JSON.parse(JSON.stringify(entry));
    return previous ? evaluations.map(existing => existing.id === previous.id ? copy : existing) : [...evaluations, copy];
  }

  /** @param {import("./types").ReviewEvaluation[]} evaluations Existing history. @param {string} reviewId Review ID to remove. @returns {import("./types").ReviewEvaluation[]} New array without the review. */
  function remove(evaluations, reviewId) {
    validate(evaluations);
    if (!evaluations.some(entry => entry.id === reviewId)) throw new Error(`This ${label} review no longer exists. Reload the latest data.`);
    return evaluations.filter(entry => entry.id !== reviewId);
  }

  /** @param {import("./types").ReviewEvaluation[]} evaluations Review history. @param {import("./types").TeamId} previousId Old team ID. @param {Pick<import("./types").Team, "id"|"name">} team New team identity. @returns {import("./types").ReviewEvaluation[]} Validated history with team snapshots remapped. */
  function rename(evaluations, previousId, team) {
    validate(evaluations);
    return validate(evaluations.map(entry => entry.team.id === previousId ? { ...entry, team: { id: team.id, name: team.name } } : entry));
  }

  // Backups merge by review ID: new reviews are added, and the most recently saved version of an edited review wins.
  /** @param {import("./types").ReviewEvaluation[]} existing Local history. @param {import("./types").ReviewEvaluation[]} incoming Backup/shared history. @returns {import("./types").ReviewEvaluation[]} Merged reviews by ID and latest update time. */
  function merge(existing, incoming) {
    validate(existing); validate(incoming);
    const byId = new Map(existing.map(entry => [entry.id, entry]));
    for (const entry of incoming) {
      const previous = byId.get(entry.id);
      if (previous && Date.parse(entry.updatedAt) === Date.parse(previous.updatedAt) && JSON.stringify(entry) !== JSON.stringify(previous)) throw new Error(`Conflicting ${label} evaluations for ${entry.team.id} in backup.`);
      if (!previous || Date.parse(entry.updatedAt) > Date.parse(previous.updatedAt)) byId.set(entry.id, entry);
    }
    return [...byId.values()];
  }

  /** @param {import("./types").ReviewEvaluation[]} evaluations Reviews to export. @returns {string} Formula-safe CSV with rubric-specific criterion columns. */
  function csv(evaluations) {
    validate(evaluations);
    const headers = ["Team", "Team name", "Review number", "Evaluation date", "Reviewer", "Saved at (UTC)", "Rubric version", "Total", "Criteria scored", ...criteria.flatMap(item => [item.title, `${item.title} notes`]), "Overall feedback", "Game", "Review role", "Author email"];
    const ordered = [...evaluations].sort((a, b) => Game.of(a).localeCompare(Game.of(b)) || a.team.id.localeCompare(b.team.id, "en", { numeric: true }) || chronological(a, b));
    const numbers = new Map();
    const rows = ordered.map(entry => {
      const result = summary(entry);
      const key = `${Game.of(entry)}|${entry.team.id}`;
      numbers.set(key, (numbers.get(key) || 0) + 1);
      return [entry.team.id, entry.team.name, numbers.get(key), entry.evaluatedOn, entry.reviewer, entry.updatedAt, entry.version, result.total, result.scored, ...criteria.flatMap(({ id }) => [entry.scores[id] ?? "", entry.notes[id]]), entry.overallNotes, Game.of(entry), entry.reviewRole || "coach", entry.authorEmail || ""];
    });
    const cell = value => {
      const content = String(value);
      return `"${(/^\s*[=+@-]|^[\t\r\n]/.test(content) ? "'" : "") + content.replace(/"/g, '""')}"`;
    };
    return [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
  }

  return { version, criteria, minimum, maximum, validate, summary, reviews, current, save, remove, rename, merge, csv };
  }

  const api = createRubric(notebookCriteria, 1, 4, "notebook");
  const interview = createRubric([
    { id: "own-work", section: "Explain your learning", title: "Students explain their own work", prompt: "Explore how students explain a robot feature, program, or strategy and the reasoning behind it.", questions: ["Which part of the robot, code, or game plan did you work on?", "How does it work, and why did you choose that approach?"] },
    { id: "development", section: "Explain your learning", title: "Students trace how they got there", prompt: "Listen for a sequence of attempts, obstacles, and discoveries that influenced the team's approach.", questions: ["What did you try first, and what did you try next?", "What did not work as expected, and what did you learn from it?"] },
    { id: "evidence", section: "Explain your learning", title: "Students show how they know it works", prompt: "Ask how the team checked its solution and what the results taught them.", questions: ["How did you check whether your robot worked as planned?", "What did you observe or measure, and what changed because of the result?"] },
    { id: "shared-learning", section: "Working with others", title: "Students learned from and with each other", prompt: "Look for examples of students exchanging skills and building on one another's understanding.", questions: ["What is something a teammate taught you?", "How did you help someone else learn a skill?"] },
    { id: "shared-decisions", section: "Working with others", title: "Decisions were made together", prompt: "Explore how students participate in choices and work through differing opinions.", questions: ["Tell us about a choice your team had to make.", "How did everyone share ideas and agree on what to try?"] },
    { id: "adaptation", section: "Working with others", title: "Outside ideas were made their own", prompt: "Ask how the team credited, modified, tested, and understood an idea from elsewhere.", questions: ["Did an outside idea inspire your robot or code?", "How did you adapt or test that idea, and how did you credit its source?"] }
  ], 0, 2, "interview");
  api.Interview = interview;
  /** @param {import("./types").ScoreHistoryRecord[]} records Score history. @param {import("./types").Team[]} [teams=[]] Current roster. @param {import("./types").ReviewEvaluation[]} [notebooks=[]] Notebook reviews. @param {import("./types").ReviewEvaluation[]} [interviews=[]] Interview reviews. @param {(record: import("./types").ScoreHistoryRecord, teamId: import("./types").TeamId) => boolean} [include] History filter. @returns {import("./types").CombinedRankingRow[]} Combined 100-point rows with ranks and missing-data notes. */
  api.combinedRanking = function (records, teams = [], notebooks = [], interviews = [], include = () => true) {
    api.validate(notebooks);
    interview.validate(interviews);
    const History = typeof module !== "undefined" && module.exports ? require("./history.js") : root.ScoreHistory;
    const directory = new Map([...notebooks, ...interviews].map(entry => [entry.team.id, entry.team]));
    for (const team of History.teamDirectory(records, teams)) directory.set(team.id, team);
    const allTeams = [...directory.values()];
    const skills = History.skillsRanking(records, allTeams, include);
    const teamwork = new Map(History.teamworkRanking(records, allTeams, include).map(row => [row.id, row]));
    const skillLeader = Math.max(0, ...skills.map(row => row.total));
    const teamworkLeader = Math.max(0, ...[...teamwork.values()].map(row => row.best ?? 0));
    const leaderPoints = (score, leader) => leader > 0 ? 25 * Math.log1p(score) / Math.log1p(leader) : 0;
    const rows = skills.map(team => {
      const match = teamwork.get(team.id);
      const notebook = api.current(notebooks, team.id);
      const interviewEntry = interview.current(interviews, team.id);
      const notebookSummary = notebook || { total: 0, scored: 0 };
      const interviewSummary = interviewEntry || { total: 0, scored: 0 };
      const skillsPoints = leaderPoints(team.total, skillLeader);
      const teamworkPoints = leaderPoints(match.best ?? 0, teamworkLeader);
      const notebookPoints = notebookSummary.total / 64 * 40;
      const interviewPoints = interviewSummary.total / 12 * 10;
      const missing = [];
      if (team.driverDate === "--") missing.push("No Driver result");
      if (team.autonomousDate === "--") missing.push("No Autonomous result");
      if (!match.played) missing.push("No Teamwork result");
      if (!notebook) missing.push("No notebook evaluation");
      else if (notebookSummary.scored < 16) missing.push(`Notebook incomplete (${notebookSummary.scored}/16)`);
      if (!interviewEntry) missing.push("No interview evaluation");
      else if (interviewSummary.scored < 6) missing.push(`Interview incomplete (${interviewSummary.scored}/6)`);
      const total = skillsPoints + teamworkPoints + notebookPoints + interviewPoints;
      return { id: team.id, name: team.name, skills: team.total, teamwork: match.best ?? 0, notebook: notebookSummary.total, interview: interviewSummary.total, skillsPoints, teamworkPoints, notebookPoints, interviewPoints, total, missing, rank: null };
    });
    rows.sort((a, b) => b.total - a.total || a.id.localeCompare(b.id, "en", { numeric: true }));
    let previous;
    rows.forEach((row, index) => {
      row.rank = previous && Math.abs(previous.total - row.total) < 1e-10 ? previous.rank : index + 1;
      previous = row;
    });
    return rows;
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.NotebookRubric = api; root.InterviewRubric = interview; }
})(globalThis);

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

(function (root) {
  "use strict";
  // Change-based shared saves. A page sends only what it changed since it last loaded or saved; the server applies
  // those changes to the latest stored event. Each match, skills attempt, review, and robot version merges on its own,
  // so two people only conflict when they change the same item (or the same setting) at the same time.

  const stable = value => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    return JSON.stringify(value === undefined ? null : value);
  };

  // Collections merged per item. Ordered collections also carry their item order (a new schedule or finals bracket).
  const COLLECTIONS = {
    matches: { id: match => String(match.id), ordered: true },
    finals: { id: match => String(match.id), ordered: true },
    skills: { id: entry => `${entry.team}:${entry.mode}:${entry.attempt}` },
    rubrics: { id: entry => entry.id },
    interviews: { id: entry => entry.id },
    robots: { id: robot => robot.id }
  };
  // Each person's own selection: the latest save wins and never conflicts.
  const PERSONAL = new Set(["selected", "selectedPhase"]);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const validKey = key => typeof key === "string" && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key) && !["constructor", "prototype"].includes(key);

  function diff(base, next) {
    const changes = [];
    const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
    for (const key of keys) {
      if (key === "history") {
        const known = new Set((base.history || []).map(record => record.id));
        const records = (next.history || []).filter(record => !known.has(record.id));
        if (records.length) changes.push({ type: "history", records });
      } else if (own(COLLECTIONS, key)) {
        const { id, ordered } = COLLECTIONS[key];
        const before = new Map((base[key] || []).map(item => [id(item), item]));
        const after = new Map((next[key] || []).map(item => [id(item), item]));
        for (const itemId of new Set([...before.keys(), ...after.keys()])) {
          const from = before.get(itemId) ?? null;
          const to = after.get(itemId) ?? null;
          if (stable(from) !== stable(to)) changes.push({ type: "item", key, id: itemId, before: from, after: to });
        }
        const order = list => (list || []).map(id);
        if (ordered && stable(order(base[key])) !== stable(order(next[key]))) changes.push({ type: "order", key, before: order(base[key]), after: order(next[key]) });
      } else if (stable(base[key]) !== stable(next[key])) {
        changes.push({ type: "value", key, before: base[key] ?? null, after: next[key] ?? null });
      }
    }
    return changes;
  }

  function label(change) {
    if (change.type === "order") return change.key === "finals" ? "the finals bracket" : "the schedule";
    if (change.type === "value") return { teams: "the team roster", name: "the event name", rounds: "the schedule", start: "the schedule", interval: "the schedule", sessionId: "the session", finalsWithdrawn: "finals withdrawals", skillsOnly: "the event type", game: "the game" }[change.key] || `the ${change.key} setting`;
    if (change.type === "history") return "score history";
    const item = change.after || change.before;
    if (change.key === "matches") return `match Q${item.id}`;
    if (change.key === "finals") return "a finals match";
    if (change.key === "skills") return `${item.team}'s ${item.mode} skills attempt ${item.attempt}`;
    if (change.key === "rubrics") return `a ${item.team.id} notebook review`;
    if (change.key === "interviews") return `a ${item.team.id} interview review`;
    return `a ${item.team} robot version`;
  }

  // Returns the merged event and the changes that could not be applied because someone else changed the same thing.
  // A change already present in the stored event (a retried save) is accepted without applying it twice.
  function apply(stored, changes) {
    const event = { ...stored };
    const conflicts = [];
    const swap = (current, change) => {
      if (stable(current) === stable(change.after)) return "same";
      return stable(current) === stable(change.before) ? "apply" : "conflict";
    };
    const items = {};
    const itemsOf = key => {
      if (!items[key]) items[key] = new Map((stored[key] || []).map(item => [COLLECTIONS[key].id(item), item]));
      return items[key];
    };
    for (const change of changes) {
      if (!change || typeof change !== "object") throw new Error("Invalid shared change.");
      if (change.type !== "history" && (!validKey(change.key) || change.key === "history")) throw new Error("Invalid shared change.");
      if (change.type === "value") {
        if (PERSONAL.has(change.key)) { event[change.key] = change.after; continue; }
        const result = swap(stored[change.key] ?? null, change);
        if (result === "apply") event[change.key] = change.after;
        else if (result === "conflict") conflicts.push(label(change));
      } else if (change.type === "item") {
        if (!own(COLLECTIONS, change.key) || typeof change.id !== "string") throw new Error("Invalid shared change.");
        const map = itemsOf(change.key);
        const result = swap(map.get(change.id) ?? null, change);
        if (result === "conflict") conflicts.push(label(change));
        else if (change.after === null) map.delete(change.id);
        else map.set(change.id, change.after);
      } else if (change.type === "history") {
        if (!Array.isArray(change.records)) throw new Error("Invalid shared change.");
        const known = new Map((event.history || []).map(record => [record.id, record]));
        const added = [];
        for (const record of change.records) {
          if (!known.has(record.id)) { added.push(record); known.set(record.id, record); }
          else if (stable(known.get(record.id)) !== stable(record)) conflicts.push(label(change));
        }
        event.history = [...(event.history || []), ...added];
      } else if (change.type === "order") {
        if (!own(COLLECTIONS, change.key) || !COLLECTIONS[change.key].ordered || !Array.isArray(change.after) || !Array.isArray(change.before)) throw new Error("Invalid shared change.");
        itemsOf(change.key);
      } else throw new Error("Invalid shared change.");
    }
    for (const key of Object.keys(items)) {
      const map = items[key];
      const order = changes.find(change => change.type === "order" && change.key === key);
      if (order) {
        const current = (stored[key] || []).map(COLLECTIONS[key].id);
        const result = swap(current, order);
        if (result === "conflict" || order.after.some(id => !map.has(id)) || map.size !== order.after.length) { conflicts.push(label(order)); continue; }
        event[key] = order.after.map(id => map.get(id));
      } else {
        const kept = (stored[key] || []).map(COLLECTIONS[key].id).filter(id => map.has(id));
        const added = [...map.keys()].filter(id => !kept.includes(id));
        event[key] = [...kept, ...added].map(id => map.get(id));
      }
    }
    // A selection that no longer exists after merging falls back to none.
    const phase = event.selectedPhase === "finals" ? event.finals : event.matches;
    if (event.selected !== null && event.selected !== undefined && !(phase || []).some(match => match.id === event.selected)) event.selected = null;
    return { event, conflicts: [...new Set(conflicts)] };
  }

  const api = { diff, apply, label, stable, PERSONAL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EventChanges = api;
})(globalThis);
