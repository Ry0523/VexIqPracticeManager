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
