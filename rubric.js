(function (root) {
  "use strict";
  const Game = typeof module !== "undefined" && module.exports ? require("./game.js") : root.VexGame;
  // Each saved review is kept separately, so a team builds a dated review history per game (season).
  // Reviews saved before review history existed get a stable ID so backups from either version merge cleanly.
  const legacyId = entry => `legacy:${Game.of(entry)}|${entry.team.id}`;
  const historyModel = () => typeof module !== "undefined" && module.exports ? require("./history.js") : root.ScoreHistory;
  const notebookCriteria = [
    { id: "navigation", section: "Notebook organization", title: "Finding information", prompt: "Review how easily a reader can navigate to a particular entry." },
    { id: "contributors", section: "Notebook organization", title: "Team and contributor identification", prompt: "Check whether the notebook identifies the team and the students responsible for entries." },
    { id: "season", section: "Notebook organization", title: "Season-long record", prompt: "Review the distribution and consistency of dated entries across the season." },
    { id: "sources", section: "Notebook organization", title: "Source attribution", prompt: "Check how outside contributions are credited alongside the work that uses them." },
    { id: "constraints", section: "Define", title: "Problem, criteria, and constraints", prompt: "Review the challenge definition and the limits a successful solution must satisfy." },
    { id: "strategy", section: "Define", title: "Game strategy", prompt: "Look for the reasoning and tradeoffs behind scoring priorities." },
    { id: "brainstorm", section: "Define", title: "Brainstorming", prompt: "Review the range of candidate approaches and how they are compared." },
    { id: "prototypes", section: "Develop solutions", title: "Prototype development", prompt: "Trace the progression between successive prototypes." },
    { id: "procedures", section: "Develop solutions", title: "Test procedures", prompt: "Consider whether another person could repeat the team's tests." },
    { id: "data", section: "Develop solutions", title: "Data collection", prompt: "Review the observations and measurements recorded for making decisions." },
    { id: "decisions", section: "Develop solutions", title: "Evidence-based decisions", prompt: "Look for a connection between choices, supporting evidence, and the people involved." },
    { id: "mechanisms", section: "Optimize", title: "Mechanism documentation", prompt: "Review how visual and written explanations communicate the built mechanism." },
    { id: "code", section: "Optimize", title: "Code documentation", prompt: "Consider how the notebook explains software intent and development." },
    { id: "changes", section: "Optimize", title: "Changes linked to test results", prompt: "Trace robot and software revisions back to testing evidence." },
    { id: "reflection", section: "Reflection and iteration", title: "Ongoing reflection", prompt: "Look for evaluation of progress that informs subsequent work." },
    { id: "iteration", section: "Reflection and iteration", title: "Visible iteration", prompt: "Trace repeated design cycles across building, strategy, and programming." }
  ];
  const text = (value, limit) => typeof value === "string" && value.length <= limit;
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

  function createRubric(criteria, minimum, maximum, label) {
  const version = "v2.0";
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

  function summary(entry) {
    validate([entry]);
    const values = criteria.map(({ id }) => entry.scores[id]).filter(value => value !== null);
    return { total: values.reduce((sum, score) => sum + score, 0), scored: values.length, maximum: criteria.length * maximum };
  }

  // Review date first; reviews on the same date keep the order they were first saved, even after later edits.
  const chronological = (a, b) => a.evaluatedOn.localeCompare(b.evaluatedOn) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);

  function reviews(evaluations, teamId) {
    return evaluations.filter(entry => entry.team.id === teamId).sort(chronological);
  }

  // Current coach result: student reviews never replace coach scores or reference notes.
  // Each criterion uses its latest assessed coach score and latest nonblank coach note.
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

  function remove(evaluations, reviewId) {
    validate(evaluations);
    if (!evaluations.some(entry => entry.id === reviewId)) throw new Error(`This ${label} review no longer exists. Reload the latest data.`);
    return evaluations.filter(entry => entry.id !== reviewId);
  }

  function rename(evaluations, previousId, team) {
    validate(evaluations);
    return validate(evaluations.map(entry => entry.team.id === previousId ? { ...entry, team: { id: team.id, name: team.name } } : entry));
  }

  // Backups merge by review ID: new reviews are added, and the most recently saved version of an edited review wins.
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
    { id: "own-work", section: "Explain your learning", title: "Understanding their own work", prompt: "Explore how students explain a robot feature, program, or strategy and the reasoning behind it." },
    { id: "development", section: "Explain your learning", title: "Explaining the development journey", prompt: "Listen for a sequence of attempts, obstacles, and discoveries that influenced the team's approach." },
    { id: "evidence", section: "Explain your learning", title: "Supporting performance with evidence", prompt: "Ask how the team checked its solution and what the results taught them." },
    { id: "shared-learning", section: "Working with others", title: "Learning together", prompt: "Look for examples of students exchanging skills and building on one another's understanding." },
    { id: "shared-decisions", section: "Working with others", title: "Collaborative decision-making", prompt: "Explore how students participate in choices and work through differing opinions." },
    { id: "adaptation", section: "Working with others", title: "Adapting outside inspiration", prompt: "Ask how the team credited, modified, tested, and understood an idea from elsewhere." }
  ], 0, 2, "interview");
  api.Interview = interview;
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
    const rows = skills.map(team => {
      const match = teamwork.get(team.id);
      const notebook = api.current(notebooks, team.id);
      const interviewEntry = interview.current(interviews, team.id);
      const notebookSummary = notebook || { total: 0, scored: 0 };
      const interviewSummary = interviewEntry || { total: 0, scored: 0 };
      const skillsPoints = skillLeader ? team.total / skillLeader * 25 : 0;
      const teamworkPoints = teamworkLeader ? (match.best ?? 0) / teamworkLeader * 25 : 0;
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
