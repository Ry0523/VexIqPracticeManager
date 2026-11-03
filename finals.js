(function (root) {
  "use strict";
  const Core = typeof module !== "undefined" && module.exports ? require("./core.js") : root.MatchCore;
  const Game = Core.Game;

  function eligible(teams, qualifications, game = Game.active) {
    return Core.standings(teams, qualifications, game).filter(team => qualifications.some(match => match.teams.includes(team.id) && match.surrogate !== team.id));
  }

  function generate(teams, qualifications, count, game = Game.active) {
    if (!qualifications.length || qualifications.some(match => !match.result)) throw new Error("Post every qualification result before generating finals.");
    const ranked = eligible(teams, qualifications, game);
    if (!Number.isInteger(count) || count < 2 || count % 2 || count > ranked.length) throw new Error("Choose an even number of advancing teams, from 2 up to the number of qualified teams.");
    const alliances = [];
    for (let index = 0; index < count; index += 2) alliances.push({ seed: index / 2 + 1, teams: ranked.slice(index, index + 2).map(team => team.id) });
    return alliances.reverse().map((alliance, index) => ({ ...alliance, phase: "finals", id: index + 1, round: 1, surrogate: null, result: null }));
  }

  function score(match, game = Game.active) {
    if (!match.result) return null;
    return match.teams.some(id => match.result.statuses[id] === "dq") || match.teams.every(id => match.result.statuses[id] === "absent") ? 0 : Core.score(match.result.counts, game);
  }

  function stopTime(match) {
    return match.teams.some(id => match.result.statuses[id] === "dq") || match.teams.every(id => match.result.statuses[id] === "absent") ? 0 : match.result.stopTime;
  }

  function validateMatch(match, teams, game = Game.active) {
    if (!match || match.phase !== "finals" || !Number.isInteger(match.id) || match.id < 1 || !Number.isInteger(match.seed) || match.seed < 1 || ![1, 2, 3].includes(match.round) || match.surrogate !== null || !Array.isArray(match.teams) || match.teams.length < 1 || match.teams.length > 2 || new Set(match.teams).size !== match.teams.length || !match.teams.every(id => teams.some(team => team.id === id))) throw new Error("Invalid finals match or alliance.");
    if (match.result !== null) {
      Core.validateResult(match.result, game, "Finals goal breakdown does not match the score.");
      if (!match.result.statuses || !match.teams.every(id => ["ok", "dq", "absent"].includes(match.result.statuses[id]))) throw new Error("Invalid finals result status.");
      if (!Number.isInteger(match.result.stopTime) || match.result.stopTime < 0 || match.result.stopTime > Core.TIMING.matchMs / 1000 || (match.round === 1 && match.result.stopTime !== 0)) throw new Error(`Finals Stop Time must be 0-${Core.TIMING.matchMs / 1000} seconds and is only used in tiebreakers.`);
    }
    return match;
  }

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

  function tiebreakers(matches, game = Game.active) {
    const status = outcome(matches, game);
    if (!status.nextRound) throw new Error("Finish the current finals series first; a new tiebreaker is only needed for an unresolved first-place tie.");
    return status.pending.slice().sort((a, b) => b - a).map((seed, index) => ({
      ...matches.find(match => match.round === 1 && match.seed === seed),
      id: matches.length + index + 1, round: status.nextRound, result: null
    }));
  }

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
