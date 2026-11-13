"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const History = require("../../history.js");
const Core = require("../../event-rules.js");
const V5 = require("../../games/override/definition.js");

function fixture() {
  const counts = [1, 2, 3, 4, 5];
  return {
    name: "Practice",
    skillsOnly: false,
    teams: [
      { id: "1A", name: "First", draw: 0 },
      { id: "2A", name: "Second", draw: 1 },
    ],
    matches: [
      {
        id: 1,
        round: 1,
        teams: ["1A", "2A"],
        surrogate: "2A",
        result: { counts, goals: Core.goalsFromCounts(counts), statuses: { "1A": "ok", "2A": "dq" } },
      },
    ],
    skills: [
      {
        team: "1A",
        mode: "driver",
        attempt: 1,
        counts: [0, 0, 0, 0, 2],
        status: "ok",
        optIn: true,
        stopTime: 12,
      },
    ],
  };
}

function parseCsv(text) {
  return text
    .split("\r\n")
    .map((line) =>
      [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) => match[1].replace(/""/g, '"')),
    );
}

test("local display dates follow viewing time zone across midnight and daylight saving", () => {
  const { execFileSync } = require("node:child_process");
  const script = `
    const History = require(${JSON.stringify(require.resolve("../../history.js"))});
    const timestamps = ["2026-10-29T02:30:00Z", "2026-01-15T12:00:00Z", "2026-07-15T12:00:00Z"];
    console.log(JSON.stringify(timestamps.map(value => ({
      day: History.localDate(value), text: History.localDateTime(value),
      expected: new Date(value).toLocaleString(undefined, {year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true,timeZoneName:"short"})
    }))));
  `;
  const run = (zone) =>
    JSON.parse(
      execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: zone }, encoding: "utf8" }),
    );
  const eastern = run("America/New_York");
  const tokyo = run("Asia/Tokyo");
  assert.equal(eastern[0].day, "2026-10-28");
  assert.equal(tokyo[0].day, "2026-10-29");
  assert.ok(eastern[1].text.includes("7:00 AM"));
  assert.ok(!eastern[1].text.includes("7:00:00"));
  assert.ok(eastern[2].text.includes("8:00 AM"));
  for (const result of [...eastern, ...tokyo]) assert.equal(result.text, result.expected);
  assert.equal(History.localDate(null), "Unknown");
  assert.equal(History.localDateTime(null), "Unknown");
});

test("history on-screen timestamps use local formatting without changing export timestamps", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const event = History.initialize(fixture());
  event.history[0].recordedAt = "2026-10-29T02:30:00Z";
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "app.js"), "utf8");
  const render = source.slice(
    source.indexOf("function renderHistory()"),
    source.indexOf("function analysisRecords()"),
  );
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        innerHTML: "",
        textContent: "",
        hidden: false,
        children: [],
        querySelector: () => ({ textContent: "" }),
      });
    return elements.get(id);
  };
  const label = source.slice(
    source.indexOf("function matchLabel("),
    source.indexOf("function qualificationLocked("),
  );
  vm.runInNewContext(label + render + "\nrenderHistory();", {
    state: event,
    Core,
    History,
    Finals: require("../../finals.js"),
    get,
    escapeText: String,
    document: { querySelectorAll: () => [], querySelector: () => ({ textContent: "" }) },
    analysisSort: { field: "rank", direction: "ascending" },
    analysisRanking: () => require("../../rubric.js").combinedRanking(event.history, event.teams),
    renderTeamAnalysis() {},
    ACTIVE_GAME: Core.Game.active,
    seasonHistory: () => History.forGame(event.history),
  });
  assert.ok(get("history-records").innerHTML.includes(History.localDateTime(event.history[0].recordedAt)));
  assert.ok(!get("history-records").innerHTML.includes("2026-10-29T02:30:00Z"));
  assert.ok(History.csv(event.history).includes('"2026-10-29T02:30:00Z"'));
});

test("all-time best-score dates distinguish migrated dates, missing modes, and separate skills runs", () => {
  const event = History.initialize(fixture());
  assert.equal(History.teamworkRanking(event.history)[0].bestDate, "Unknown");
  const original = History.skillsRanking(event.history).find((row) => row.id === "1A");
  assert.equal(original.driverDate, "Unknown");
  assert.equal(original.autonomousDate, "--");
  const practice = History.practiceRecord(event.history, event.teams, {
    mode: "autonomous",
    teams: ["1A"],
    goals: Core.goalsFromCounts([7, 0, 0, 0, 0]),
    occurredAt: "2026-10-28T23:30:00-04:00",
    notes: "",
    status: "ok",
    optIn: false,
    stopTime: 0,
  });
  const driver = {
    ...event.history.find((record) => record.kind === "skills"),
    id: History.newId(),
    recordedAt: "2026-10-27T10:00:00Z",
    action: "updated",
  };
  const row = History.skillsRanking([...event.history, driver, practice]).find((team) => team.id === "1A");
  assert.equal(row.driverDate, "2026-10-27");
  const local = new Date(practice.occurredAt);
  assert.equal(
    row.autonomousDate,
    `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`,
  );
  const unranked = History.skillsRanking([], [{ id: "3A", name: "New" }])[0];
  assert.equal(unranked.driverDate, "--");
  assert.equal(History.teamworkRanking([], [{ id: "3A", name: "New" }])[0].bestDate, "--");
});

test("best-score dates select earliest known tied result and follow corrections and removals", () => {
  const event = History.initialize(fixture());
  const input = {
    mode: "teamwork",
    teams: ["1A", "2A"],
    goals: Core.goalsFromCounts([5, 0, 0, 0, 0]),
    occurredAt: "2026-10-20T10:00:00Z",
    notes: "",
    statuses: { "1A": "ok", "2A": "ok" },
  };
  const first = History.practiceRecord([], event.teams, input);
  const second = History.practiceRecord([first], event.teams, {
    ...input,
    occurredAt: "2026-10-25T10:00:00Z",
  });
  assert.equal(History.teamworkRanking([second, first])[0].bestDate, "2026-10-20");
  const corrected = History.practiceRecord(
    [first, second],
    event.teams,
    { ...input, goals: Core.goalsFromCounts([1, 0, 0, 0, 0]) },
    first.runId,
  );
  assert.equal(History.teamworkRanking([first, second, corrected])[0].bestDate, "2026-10-25");
  const removed = History.removePractice([first, second, corrected], second.runId);
  assert.equal(History.teamworkRanking([first, second, corrected, removed])[0].bestDate, "2026-10-20");
});

test("all-time teamwork ranks best scores across events and practice with ties and unranked teams", () => {
  const event = History.initialize(fixture());
  const practice = History.practiceRecord(event.history, event.teams, {
    mode: "teamwork",
    teams: ["1A", "2A"],
    goals: Core.goalsFromCounts([10, 0, 0, 0, 0]),
    occurredAt: "2026-10-29T10:00:00Z",
    notes: "",
    statuses: { "1A": "ok", "2A": "ok" },
  });
  const rows = History.teamworkRanking(
    [...event.history, practice],
    [
      { id: "1A", name: "Current" },
      { id: "3A", name: "New" },
    ],
  );
  assert.equal(rows[0].name, "Current");
  assert.equal(rows[0].best, Core.score(event.matches[0].result.counts));
  assert.equal(rows[0].played, 2);
  assert.equal(rows[1].best, 10);
  assert.equal(rows[2].rank, null);
  assert.equal(rows[2].best, null);
  const tied = History.teamworkRanking([practice]);
  assert.deepEqual(
    tied.map((row) => row.rank),
    [1, 1],
  );
});

test("all-time teamwork resolves corrections, removals and voids and keeps status-adjusted zeros", () => {
  const event = History.initialize(fixture());
  const original = event.history.find((record) => record.kind === "teamwork");
  const corrected = structuredClone(original);
  corrected.id = History.newId();
  corrected.action = "updated";
  corrected.recordedAt = "2026-10-29T10:00:00Z";
  corrected.value.result.counts = [2, 0, 0, 0, 0];
  corrected.value.result.goals = Core.goalsFromCounts(corrected.value.result.counts);
  const rows = History.teamworkRanking([original, corrected]);
  assert.equal(rows[0].best, 2);
  assert.equal(rows[1].best, 0);
  assert.equal(rows[1].rank, 2);
  assert.equal(rows[1].played, 1);
  for (const action of ["removed", "voided"]) {
    const removed = { ...corrected, id: History.newId(), action, recordedAt: "2026-10-30T10:00:00Z" };
    assert.ok(
      History.teamworkRanking([original, corrected, removed]).every(
        (row) => row.rank === null && row.played === 0,
      ),
    );
  }
});

test("teamwork leaderboard hides only qualification rankings when no schedule exists", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "app.js"), "utf8");
  const render = source.slice(
    source.indexOf("function renderStandings()"),
    source.indexOf("function updateEstimate()"),
  );
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, innerHTML: "" });
    return elements.get(id);
  };
  const event = { ...History.initialize(fixture()), robots: [] };
  const context = vm.createContext({
    state: event,
    Core,
    History,
    get,
    escapeText: String,
    average: String,
    seasonHistory: () => History.forGame(event.history),
  });
  vm.runInContext(render + "\nrenderStandings();", context);
  assert.equal(get("qualification-rankings").hidden, false);
  const allTime = get("teamwork-all-time").innerHTML;
  assert.ok(allTime.includes("First"));
  event.matches = [];
  vm.runInContext("renderStandings();", context);
  assert.equal(get("qualification-rankings").hidden, true);
  assert.equal(get("teamwork-all-time").innerHTML, allTime);
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const rankingsTab = html.match(/<button\b(?=[^>]*data-tab="rankings")[^>]*>[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(rankingsTab, /aria-pressed="false"/);
  assert.match(rankingsTab, /Teamwork\s+leaderboard/);
  assert.ok(html.indexOf('id="qualification-rankings"') < html.indexOf('id="teamwork-all-time"'));
});

test("skills leaderboard shows all-time results independently and handles skills-only active events", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "skills.js"), "utf8");
  const render = source.slice(
    source.indexOf("  function renderLeaderboard()"),
    source.indexOf("  function renderSkills()"),
  );
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, innerHTML: "" });
    return elements.get(id);
  };
  const event = History.initialize(fixture());
  const practice = History.practiceRecord(event.history, event.teams, {
    mode: "autonomous",
    teams: ["1A"],
    goals: Core.goalsFromCounts([7, 0, 0, 0, 0]),
    occurredAt: "2026-10-29T10:00:00Z",
    notes: "",
    status: "ok",
    optIn: false,
    stopTime: 0,
  });
  event.history.push(practice);
  event.robots = [];
  const context = vm.createContext({
    state: event,
    Core,
    History,
    get,
    escapeText: String,
    selection: { team: null },
    participated: () => true,
    admission: () => "Confirmed",
    seasonHistory: () => History.forGame(event.history),
  });
  vm.runInContext(render + "\nrenderLeaderboard();", context);
  assert.equal(get("skills-event-rankings").hidden, false);
  const allTime = get("skills-all-time").innerHTML;
  assert.ok(allTime.includes("<strong>39</strong>"));
  event.matches = [];
  event.skills = [];
  vm.runInContext("renderLeaderboard();", context);
  assert.equal(get("skills-event-rankings").hidden, true);
  assert.equal(get("skills-all-time").innerHTML, allTime);
  event.skillsOnly = true;
  vm.runInContext("renderLeaderboard();", context);
  assert.equal(get("skills-event-rankings").hidden, false);
  event.skillsOnly = false;
  event.skills = fixture().skills;
  vm.runInContext("renderLeaderboard();", context);
  assert.equal(get("skills-event-rankings").hidden, false);
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  assert.ok(html.indexOf('id="skills-event-rankings"') < html.indexOf('id="skills-all-time"'));
});

test("legacy scores migrate once, without inventing timestamps or goal colors", () => {
  const event = History.initialize(fixture());
  assert.equal(event.history.length, 2);
  assert.ok(event.sessionId);
  assert.ok(event.history.every((record) => record.action === "migrated" && record.recordedAt === null));
  const restored = History.initialize(JSON.parse(JSON.stringify(event)));
  assert.deepEqual(restored, event);
  assert.equal(restored.history[1].value.goals, undefined);
});

test("history snapshots retain all score versions and original identities after edits and resets", () => {
  const event = History.initialize(fixture());
  const original = JSON.parse(JSON.stringify(event.history));
  event.matches[0].result.counts = [2, 0, 0, 0, 0];
  event.matches[0].result.goals = Core.goalsFromCounts(event.matches[0].result.counts);
  event.history.push(History.capture(event, "teamwork", event.matches[0], "updated"));
  event.history.push(History.capture(event, "teamwork", event.matches[0], "removed"));
  event.history.push(History.capture(event, "skills", event.skills[0], "voided"));
  event.teams[0].id = "9Z";
  event.teams[0].name = "Changed name";
  event.matches = [];
  event.skills = [];
  event.sessionId = History.newId();
  assert.deepEqual(event.history.slice(0, 2), original);
  assert.equal(event.history.length, 5);
  assert.equal(event.history[2].teams[0].name, "First");
  assert.equal(event.history[2].value.result.counts[0], 2);
  assert.ok(Number.isFinite(Date.parse(event.history[2].recordedAt)));
  assert.equal(History.validate(event.history), event.history);
});

test("backup merging keeps local history, deduplicates records, and rejects ID conflicts", () => {
  const first = History.initialize(fixture());
  const second = History.initialize(fixture());
  const merged = History.merge(first.history, second.history);
  assert.equal(merged.length, 4);
  assert.equal(History.merge(merged, JSON.parse(JSON.stringify(second.history))).length, 4);
  const conflicting = JSON.parse(JSON.stringify(first.history));
  conflicting[0].eventName = "Changed";
  assert.throws(() => History.merge(first.history, conflicting), /Conflicting/);
});

test("detailed CSV includes every team, status, raw counts, goal data, and stop time", () => {
  const event = History.initialize(fixture());
  const rows = parseCsv(History.csv(event.history));
  const headers = rows.shift();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.length === headers.length));
  const values = rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
  assert.equal(values[0]["Field score"], "153");
  assert.equal(values[0]["Team score"], "153");
  assert.equal(values[1]["Team score"], "0");
  assert.equal(values[1].Status, "dq");
  assert.equal(values[1].Surrogate, "true");
  assert.equal(values[0]["L4 bags"], "5");
  assert.equal(values[0]["Unassigned L3 bags"], "4");
  assert.equal(values[0]["Recorded at (UTC)"], "");
  assert.equal(values[2]["Stop time seconds"], "12");
  assert.equal(values[2]["Goal breakdown recorded"], "false");
  assert.equal(values[2]["Blue Floor bags"], "");
  assert.equal(values[2]["Team score"], "32");
  assert.equal(values[2].Attempt, "1");
});

test("importing older records cannot place them after newer corrections", () => {
  const event = History.initialize(fixture());
  const older = History.capture(event, "skills", event.skills[0], "posted", "2026-10-28T10:00:00.000Z");
  const newer = History.capture(event, "skills", event.skills[0], "updated", "2026-10-29T10:00:00.000Z");
  const merged = History.merge([newer], [older, ...event.history]);
  assert.deepEqual(
    merged.map((record) => record.action),
    ["migrated", "migrated", "posted", "updated"],
  );
});

test("CSV escapes commas and quotes, and guards spreadsheet formulas", () => {
  const event = History.initialize(fixture());
  event.history[0].eventName = ' =SUM(1,2)"';
  event.history[0].teams[0].name = '+Danger, "quoted"';
  const rows = parseCsv(History.csv(event.history));
  assert.equal(rows[1][2], "' =SUM(1,2)\"");
  assert.equal(rows[1][11], '\'+Danger, "quoted"');
});

test("malformed history is rejected rather than silently discarded", () => {
  const event = History.initialize(fixture());
  for (const change of [
    (records) => records.push(records[0]),
    (records) => {
      records[0].recordedAt = "invalid";
    },
    (records) => {
      records[0].value.result.counts[0] = 39;
    },
    (records) => {
      records[0].teams = [];
    },
    (records) => {
      records[0].value.result.statuses["1A"] = "missing";
    },
    (records) => {
      records[1].value.attempt = 4;
    },
    (records) => {
      records[0].kind = "unknown";
    },
  ]) {
    const records = JSON.parse(JSON.stringify(event.history));
    change(records);
    assert.throws(() => History.validate(records));
  }
});

test("resolution keeps corrections once, excludes removed/voided slots, and permits reposts", () => {
  const event = History.initialize(fixture());
  const match = event.matches[0];
  const entry = event.skills[0];
  event.history.push(History.capture(event, "teamwork", match, "updated"));
  event.history.push(History.capture(event, "skills", entry, "voided"));
  assert.equal(History.resolve(event.history).length, 1);
  event.history.push(History.capture(event, "teamwork", match, "removed"));
  assert.equal(History.resolve(event.history).length, 0);
  event.history.push(History.capture(event, "skills", entry, "posted"));
  assert.equal(History.resolve(event.history).length, 1);
});

test("skills identity survives team renumbering and legacy snapshots", () => {
  const event = History.initialize(fixture());
  const entry = { ...event.skills[0], team: "9Z", counts: [5, 0, 0, 0, 0] };
  event.teams[0].id = "9Z";
  event.history.push(History.capture(event, "skills", entry, "updated"));
  const resolved = History.resolve(event.history).filter((record) => record.kind === "skills");
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].value.team, "9Z");
  event.history.push(History.capture(event, "skills", entry, "voided"));
  assert.equal(History.resolve(event.history).filter((record) => record.kind === "skills").length, 0);
});

test("analysis counts alliances once, skips surrogate team scores, and separates skills modes", () => {
  const event = History.initialize(fixture());
  event.matches[0].result.statuses["1A"] = "absent";
  event.history.push(History.capture(event, "teamwork", event.matches[0], "updated"));
  const entry = {
    ...event.skills[0],
    mode: "autonomous",
    resultId: undefined,
    status: "dq",
    optIn: false,
    stopTime: 0,
  };
  event.history.push(History.capture(event, "skills", entry, "posted"));
  const { rows, resolved } = History.analyze(event.history);
  assert.equal(resolved.length, 3);
  assert.equal(rows.find((row) => row.scope === "All alliances (shared score)").count, 1);
  assert.equal(rows.find((row) => row.scope === "All alliances (shared score)").average, 153);
  assert.equal(rows.find((row) => row.scope === "1A" && row.type.startsWith("Teamwork")).average, 0);
  assert.equal(
    rows.some((row) => row.scope === "2A"),
    false,
  );
  assert.equal(rows.find((row) => row.scope === "All teams" && row.type === "Driver skills").average, 32);
  assert.equal(rows.find((row) => row.scope === "All teams" && row.type === "Autonomous skills").average, 0);
});

test("resolution separates sessions and resolves input by time, with stable equal-time order", () => {
  const event = History.initialize(fixture());
  const early = History.capture(event, "skills", event.skills[0], "posted", "2026-10-28T10:00:00Z");
  const late = History.capture(event, "skills", event.skills[0], "voided", "2026-10-29T10:00:00Z");
  assert.equal(History.resolve([late, early]).length, 0);
  const repost = History.capture(event, "skills", event.skills[0], "posted", late.recordedAt);
  assert.equal(History.resolve([early, late, repost]).length, 1);
  const other = { ...early, id: History.newId(), sessionId: History.newId() };
  assert.equal(History.resolve([early, other]).length, 2);
});

test("descriptive statistics use exact population calculations and handle empty input", () => {
  assert.deepEqual(History.statistics([]), {
    count: 0,
    average: null,
    median: null,
    best: null,
    deviation: null,
  });
  assert.deepEqual(History.statistics([2, 4, 4, 4, 5, 5, 7, 9]), {
    count: 8,
    average: 5,
    median: 4.5,
    best: 9,
    deviation: 2,
  });
  assert.deepEqual(History.statistics([7]), { count: 1, average: 7, median: 7, best: 7, deviation: 0 });
});

test("all-time skills ranking combines best modes across sessions and retains all teams", () => {
  const event = History.initialize(fixture());
  event.sessionId = History.newId();
  event.history.push(
    History.capture(
      event,
      "skills",
      { ...event.skills[0], resultId: undefined, mode: "autonomous", counts: [10, 0, 0, 0, 0] },
      "posted",
    ),
  );
  event.teams.push({ id: "3A", name: "No runs", draw: 2 });
  const rows = History.skillsRanking(event.history, event.teams);
  assert.equal(rows[0].id, "1A");
  assert.equal(rows[0].driver, 32);
  assert.equal(rows[0].autonomous, 10);
  assert.equal(rows[0].total, 42);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].rank, null);
});

test("all-time skills ranking resolves corrections, voids, zero scores, ties and roster names", () => {
  const event = History.initialize(fixture());
  event.history.push(
    History.capture(event, "skills", { ...event.skills[0], counts: [5, 0, 0, 0, 0] }, "updated"),
  );
  const second = { ...event.skills[0], team: "2A", resultId: undefined, counts: [5, 0, 0, 0, 0] };
  event.history.push(History.capture(event, "skills", second, "posted"));
  event.teams.push({ id: "3A", name: "Third", draw: 2 });
  event.history.push(
    History.capture(
      event,
      "skills",
      { ...second, team: "3A", status: "dq", optIn: false, stopTime: 0 },
      "posted",
    ),
  );
  event.teams[0].name = "Current name";
  let rows = History.skillsRanking(event.history, event.teams);
  assert.deepEqual(
    rows.map((row) => row.rank),
    [1, 1, 3],
  );
  assert.equal(rows[0].name, "Current name");
  assert.equal(rows[2].total, 0);
  event.history.push(History.capture(event, "skills", event.skills[0], "voided"));
  rows = History.skillsRanking(event.history, []);
  assert.equal(rows.find((row) => row.id === "1A").rank, null);
  assert.equal(rows.find((row) => row.id === "2A").rank, 1);
  assert.deepEqual(History.skillsRanking([], []), []);
});

test("team details include status zeros, surrogate matches, and raw alliance partner comparisons", () => {
  const event = History.initialize(fixture());
  event.matches[0].result.statuses["1A"] = "absent";
  event.history.push(History.capture(event, "teamwork", event.matches[0], "updated"));
  const detail = History.teamAnalysis(event.history, "1A");
  assert.equal(detail.modes.teamwork.count, 1);
  assert.equal(detail.modes.teamwork.average, 0);
  assert.equal(detail.modes.teamwork.absent, 1);
  assert.equal(detail.partners[0].id, "2A");
  assert.equal(detail.partners[0].fieldAverage, 153);
  assert.equal(detail.partners[0].average, 0);
  const partner = History.teamAnalysis(event.history, "2A");
  assert.equal(partner.modes.teamwork.dq, 1);
  assert.equal(partner.modes.teamwork.surrogate, 1);
  assert.equal(partner.modes.teamwork.average, 0);
  assert.equal(detail.modes.driver.best, 32);
  assert.equal(detail.modes.autonomous.count, 0);
});

test("team trends compare disjoint recent windows and exclude unknown timestamps", () => {
  const event = History.initialize(fixture());
  for (let index = 1; index <= 8; index++) {
    event.sessionId = History.newId();
    event.history.push(
      History.capture(
        event,
        "skills",
        { ...event.skills[0], resultId: undefined, counts: [index, 0, 0, 0, 0] },
        "posted",
        `2026-10-${String(index).padStart(2, "0")}T10:00:00Z`,
      ),
    );
  }
  const stats = History.teamAnalysis(event.history, "1A").modes.driver;
  assert.equal(stats.count, 9);
  assert.equal(stats.unknownDates, 1);
  assert.equal(stats.recentCount, 5);
  assert.equal(stats.previousCount, 3);
  assert.equal(stats.recentAverage, 6);
  assert.equal(stats.previousAverage, 2);
  assert.equal(stats.change, 4);
  assert.equal(stats.best, 32);
  assert.equal(stats.recentBest, 8);
  assert.equal(stats.bestDate, "Unknown");
  assert.deepEqual(
    stats.rolling.map((entry) => entry.rollingAverage),
    [1, 1.5, 2, 2.5, 3, 4, 5, 6],
  );
  assert.deepEqual(
    stats.rolling.map((entry) => entry.rollingCount),
    [1, 2, 3, 4, 5, 5, 5, 5],
  );
  assert.equal(History.teamAnalysis(event.history, "missing").modes.driver.change, null);
});

test("recent metrics retain negative trends, full-history rolling windows, and best dates", () => {
  const event = History.initialize(fixture());
  const records = [];
  for (let index = 0; index < 35; index++) {
    const value = {
      ...event.skills[0],
      resultId: History.newId(),
      counts: [index < 30 ? 10 : 0, 0, 0, 0, 0],
      optIn: false,
      stopTime: 0,
    };
    records.push(
      History.capture(
        event,
        "skills",
        value,
        "posted",
        new Date(Date.UTC(2026, 9, index + 1, 12)).toISOString(),
      ),
    );
  }
  const stats = History.teamAnalysis(records, "1A").modes.driver;
  assert.equal(stats.recentAverage, 0);
  assert.equal(stats.previousAverage, 10);
  assert.equal(stats.change, -10);
  assert.equal(stats.recentBest, 0);
  assert.equal(stats.bestDate, History.localDate(records[0].recordedAt));
  assert.equal(stats.rolling.slice(-30)[0].rollingAverage, 10);
  assert.deepEqual(
    stats.rolling.slice(-5).map((entry) => entry.rollingAverage),
    [8, 6, 4, 2, 0],
  );
  const one = History.teamAnalysis([records[0]], "1A").modes.driver;
  assert.equal(one.recentCount, 1);
  assert.equal(one.change, null);
  const empty = History.teamAnalysis([], "1A").modes.driver;
  assert.equal(empty.recentBest, null);
  assert.equal(empty.bestDate, "--");
  assert.deepEqual(empty.rolling, []);
});

test("team details replace corrected scores, omit voids/removals, and isolate modes and partners", () => {
  const event = History.initialize(fixture());
  event.history.push(
    History.capture(event, "skills", { ...event.skills[0], status: "forfeit", stopTime: 0 }, "updated"),
  );
  let detail = History.teamAnalysis(event.history, "1A");
  assert.equal(detail.modes.driver.count, 1);
  assert.equal(detail.modes.driver.average, 0);
  assert.equal(detail.modes.driver.forfeit, 1);
  assert.equal(detail.modes.driver.change, null);
  event.history.push(History.capture(event, "skills", event.skills[0], "voided"));
  event.history.push(History.capture(event, "teamwork", event.matches[0], "removed"));
  detail = History.teamAnalysis(event.history, "1A");
  assert.equal(detail.modes.driver.count, 0);
  assert.equal(detail.modes.teamwork.count, 0);
  assert.deepEqual(detail.partners, []);
});

test("robot versions isolate leaderboards to each team's current robot and compare versions", () => {
  const event = History.initialize(fixture());
  const teamwork = (counts, occurredAt) =>
    History.practiceRecord([], event.teams, {
      mode: "teamwork",
      teams: ["1A", "2A"],
      goals: Core.goalsFromCounts(counts),
      occurredAt,
      notes: "",
      statuses: { "1A": "ok", "2A": "ok" },
    });
  const driver = (counts, occurredAt) =>
    History.practiceRecord([], event.teams, {
      mode: "driver",
      teams: ["1A"],
      goals: Core.goalsFromCounts(counts),
      occurredAt,
      notes: "",
      status: "ok",
      optIn: false,
      stopTime: 0,
    });
  const oldMatch = teamwork([9, 0, 0, 0, 0], "2026-10-01T10:00:00Z");
  const newMatch = teamwork([3, 0, 0, 0, 0], "2026-11-05T10:00:00Z");
  const oldDriver = driver([8, 0, 0, 0, 0], "2026-10-02T10:00:00Z");
  const newDriver = driver([2, 0, 0, 0, 0], "2026-11-06T10:00:00Z");
  const records = [oldMatch, newMatch, oldDriver, newDriver];
  const robots = [
    { id: "r2", team: "1A", name: "Claw bot", startedAt: "2026-11-01T00:00:00Z", notes: "New intake" },
  ];
  assert.deepEqual(History.validateRobots(robots), robots);
  assert.throws(() => History.validateRobots([{ ...robots[0], name: " " }]), /robot version/);
  assert.throws(() => History.validateRobots([robots[0], robots[0]]), /robot version/);

  const scope = History.currentRobotOnly(records, robots);
  const teamworkRows = History.teamworkRanking(records, event.teams, scope);
  assert.deepEqual(
    teamworkRows.map((row) => [row.id, row.best, row.played]),
    [
      ["2A", 9, 2],
      ["1A", 3, 1],
    ],
  );
  assert.deepEqual(
    History.skillsRanking(records, event.teams, scope).find((row) => row.id === "1A").driver,
    2,
  );
  assert.equal(History.skillsRanking(records, event.teams).find((row) => row.id === "1A").driver, 8);
  assert.equal(
    History.teamworkRanking(records, event.teams, History.currentRobotOnly(records, [])).find(
      (row) => row.id === "1A",
    ).best,
    9,
  );

  const comparison = History.robotComparison(records, robots, "1A");
  assert.deepEqual(
    comparison.map((row) => [
      row.name,
      row.current,
      row.modes.teamwork.best,
      row.modes.driver.best,
      row.skillsBest,
    ]),
    [
      ["Original robot", false, 9, 8, 8],
      ["Claw bot", true, 3, 2, 2],
    ],
  );
  assert.deepEqual(
    History.robotComparison(records, robots, "2A").map((row) => row.name),
    ["Original robot"],
  );

  const exported = parseCsv(History.csv(records, robots));
  const column = exported[0].indexOf("Robot version");
  assert.deepEqual(
    exported
      .slice(1)
      .filter((row) => row[10] === "1A")
      .map((row) => row[column]),
    ["Original robot", "Claw bot", "Original robot", "Claw bot"],
  );
  assert.ok(
    exported
      .slice(1)
      .filter((row) => row[10] === "2A")
      .every((row) => row[column] === "Original robot"),
  );
  assert.deepEqual(History.renameRobots(robots, "1A", "1B")[0].team, "1B");
});

test("V5 team analysis derives practice scrimmage metrics without overstating ratings", () => {
  const teams = ["1A", "2A", "3A", "4A"].map((id, index) => ({ id, name: `Team ${id}`, draw: index }));
  const goals = V5.practice.field.empty();
  goals.quadrants[0].red = 2;
  goals.quadrants[1].blue = 1;
  goals.autonomousBonus.red = true;
  const record = History.practiceRecord(
    [],
    teams,
    {
      mode: "teamwork",
      teams: teams.map((team) => team.id),
      scrimmage: true,
      redTeams: ["1A", "2A"],
      blueTeams: ["3A", "4A"],
      gameData: goals,
      occurredAt: "2026-11-01T10:00:00Z",
      notes: "",
    },
    null,
    V5,
  );

  const metrics = History.teamAnalysis([record], "1A").scrimmage;
  assert.equal(metrics.matches, 1);
  assert.deepEqual([metrics.wins, metrics.ties, metrics.losses, metrics.wp], [1, 0, 0, 2]);
  assert.deepEqual(
    [
      metrics.ap,
      metrics.sp,
      metrics.scoreFor.average,
      metrics.scoreAgainst.average,
      metrics.scoreDifferential.average,
    ],
    [1, 5, 22, 5, 17],
  );
  assert.deepEqual([metrics.opr, metrics.dpr, metrics.ccwm], [null, null, null]);
});

test("V5 scrimmage ratings solve from varied alliance pairings", () => {
  const teams = ["1A", "2A", "3A", "4A"].map((id, index) => ({ id, name: `Team ${id}`, draw: index }));
  const contribution = { "1A": 25, "2A": 50, "3A": 75, "4A": 100 };
  const pairings = [
    { red: ["1A", "2A"], blue: ["3A", "4A"] },
    { red: ["1A", "3A"], blue: ["2A", "4A"] },
    { red: ["1A", "4A"], blue: ["2A", "3A"] },
  ];
  const records = pairings.map(({ red, blue }, index) => {
    const goals = V5.practice.field.empty();
    goals.quadrants[0].red = (contribution[red[0]] + contribution[red[1]]) / 5;
    goals.quadrants[1].blue = (contribution[blue[0]] + contribution[blue[1]]) / 5;
    return History.practiceRecord(
      [],
      teams,
      {
        mode: "teamwork",
        teams: [...red, ...blue],
        scrimmage: true,
        redTeams: red,
        blueTeams: blue,
        gameData: goals,
        occurredAt: `2026-11-0${index + 1}T10:00:00Z`,
        notes: "",
      },
      null,
      V5,
    );
  });

  const metrics = History.teamAnalysis(records, "1A").scrimmage;
  assert.ok(Math.abs(metrics.opr - contribution["1A"]) < 1e-8);
  assert.ok(Number.isFinite(metrics.dpr));
  assert.ok(Number.isFinite(metrics.ccwm));
});

test("robot attribution uses the first posting time so later corrections stay with the original robot", () => {
  const event = History.initialize(fixture());
  const posted = History.capture(event, "teamwork", event.matches[0], "posted", "2026-10-01T10:00:00Z");
  const corrected = History.capture(event, "teamwork", event.matches[0], "updated", "2026-11-10T10:00:00Z");
  const migrated = History.capture(
    { ...event, sessionId: "old" },
    "teamwork",
    event.matches[0],
    "migrated",
    null,
  );
  const robots = [{ id: "r2", team: "1A", name: "Robot 2", startedAt: "2026-11-01T00:00:00Z", notes: "" }];
  const robotOf = History.robotAttribution([posted, corrected, migrated], robots);
  assert.equal(robotOf(corrected, "1A"), null);
  assert.equal(robotOf(migrated, "1A"), null);
  assert.equal(
    History.teamworkRanking(
      [posted, corrected, migrated],
      event.teams,
      History.currentRobotOnly([posted, corrected, migrated], robots),
    ).find((row) => row.id === "1A").played,
    0,
  );
});

test("event backups migrate missing robot versions and reject invalid ones", () => {
  const EventModel = require("../../event.js");
  const base = () => ({
    version: 1,
    name: "Robots",
    teams: [{ id: "1A", name: "First", draw: 0 }],
    matches: [],
    skills: [],
    rounds: 6,
    start: "09:00",
    interval: 3,
    selected: null,
  });
  assert.deepEqual(EventModel.validate(base()).robots, []);
  const robot = { id: "r2", team: "1A", name: "Robot 2", startedAt: "2026-11-01T00:00:00Z", notes: "" };
  assert.deepEqual(EventModel.validate({ ...base(), robots: [robot] }).robots, [robot]);
  assert.throws(
    () => EventModel.validate({ ...base(), robots: [{ ...robot, startedAt: "soon" }] }),
    /robot version/,
  );
  assert.throws(() => EventModel.validate({ ...base(), robots: null }), /robot versions/);
});

test("abandoned robots keep their results out of leaderboards while later results return to the previous robot", () => {
  const event = History.initialize(fixture());
  const driver = (counts, occurredAt) =>
    History.practiceRecord([], event.teams, {
      mode: "driver",
      teams: ["1A"],
      goals: Core.goalsFromCounts(counts),
      occurredAt,
      notes: "",
      status: "ok",
      optIn: false,
      stopTime: 0,
    });
  const original = driver([4, 0, 0, 0, 0], "2026-10-01T10:00:00Z");
  const experiment = driver([9, 0, 0, 0, 0], "2026-11-05T10:00:00Z");
  const afterwards = driver([5, 0, 0, 0, 0], "2026-11-20T10:00:00Z");
  const records = [original, experiment, afterwards];
  const added = [{ id: "r2", team: "1A", name: "Experiment", startedAt: "2026-11-01T00:00:00Z", notes: "" }];
  const robots = History.abandonRobot(added, "r2", "2026-11-10T00:00:00Z");
  assert.equal(robots[0].abandonedAt, "2026-11-10T00:00:00.000Z");
  assert.equal(History.currentRobot(robots, "1A"), null);
  const robotOf = History.robotAttribution(records, robots);
  assert.deepEqual(
    records.map((record) => robotOf(record, "1A")),
    [null, "r2", null],
  );
  assert.equal(
    History.skillsRanking(records, event.teams, History.currentRobotOnly(records, robots)).find(
      (row) => row.id === "1A",
    ).driver,
    5,
  );
  assert.equal(
    History.skillsRanking(records, event.teams, History.currentRobotOnly(records, added)).find(
      (row) => row.id === "1A",
    ).driver,
    9,
  );
  assert.deepEqual(
    History.robotComparison(records, robots, "1A").map((row) => [
      row.name,
      row.current,
      row.modes.driver.count,
    ]),
    [
      ["Original robot", true, 2],
      ["Experiment", false, 1],
    ],
  );
  const exported = parseCsv(History.csv(records, robots));
  assert.deepEqual(
    exported.slice(1).map((row) => row[exported[0].indexOf("Robot version")]),
    ["Original robot", "Experiment (abandoned)", "Original robot"],
  );
  const restored = History.restoreRobot(robots, "r2");
  assert.equal(restored[0].abandonedAt, undefined);
  assert.equal(History.currentRobot(restored, "1A").id, "r2");
  assert.equal(
    History.abandonRobot(added, "r2", "2026-01-01T00:00:00Z")[0].abandonedAt,
    "2026-11-01T00:00:00.000Z",
  );
  assert.throws(
    () => History.validateRobots([{ ...added[0], abandonedAt: "2026-10-01T00:00:00Z" }]),
    /robot version/,
  );
  assert.throws(() => History.abandonRobot(added, "missing"), /no longer exists/);
});

test("resolved history is reused safely across repeated reads and in-place changes", () => {
  const event = History.initialize(fixture());
  const records = event.history;
  const first = History.resolve(records);
  first.length = 0;
  assert.ok(History.resolve(records).length > 0);
  const count = History.resolve(records).length;
  const match = event.matches.find((item) => item.result);
  records.push(History.capture(event, "teamwork", match, "removed"));
  assert.equal(History.resolve(records).length, count - 1);
  records.pop();
  assert.equal(History.resolve(records).length, count);
  records[records.length - 1] = { ...records[records.length - 1], id: "broken", action: "bogus" };
  assert.throws(() => History.resolve(records), /Invalid score history/);
});
