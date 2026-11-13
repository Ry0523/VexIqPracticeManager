"use strict";
const { test, expect } = require("@playwright/test");

const { openApp, addTeams } = require("./helpers.js");

test("IQ team analysis links profiles without bundled official standings", async ({ page }) => {
  await openApp(page);
  await addTeams(page, [["28101C", "Collaborated Croc's"], ["28102S", "Super Potatoes"]]);
  await page.click('[data-tab="analysis"]');

  await page.locator('[data-analysis-team="28101C"]').click();
  await expect(page.locator("#team-profile")).toHaveAttribute("href", "https://events.vex.com/teams/VIQRC/28101C");
  await expect(page.locator("#official-standings")).toBeHidden();

  await page.locator('[data-analysis-team="28102S"]').click();
  await expect(page.locator("#team-profile")).toHaveAttribute("href", "https://events.vex.com/teams/VIQRC/28102S");
  await expect(page.locator("#official-standings")).toBeHidden();
});

async function scheduleAndPostFirstMatch(page) {
  await addTeams(page, [["1A", "One"], ["2A", "Two"], ["3A", "Three"], ["4A", "Four"]]);
  await page.locator("#schedule-form button[type=submit]").click();
  await page.locator('#scoring-inputs [data-step="1"]').first().click();
  await page.click("#save-score");
  await expect(page.locator("#match-status")).toHaveText("Posted");
}

test("schedule print uses readable point-sized type", async ({ page }) => {
  await openApp(page);
  await scheduleAndPostFirstMatch(page);
  await page.evaluate(() => renderPrintSheet());
  await page.emulateMedia({ media: "print" });
  const sizes = await page.locator(".print-sheet").evaluate(sheet => ({
    body: getComputedStyle(sheet).fontSize,
    heading: getComputedStyle(sheet.querySelector("th")).fontSize,
    page: [...document.styleSheets].flatMap(stylesheet => [...stylesheet.cssRules]).find(rule => rule.type === CSSRule.PAGE_RULE)?.cssText
  }));
  expect(sizes).toMatchObject({ body: "16px", heading: "12px" });
  expect(sizes.page).toContain("size: letter");
});

test("team analysis shows recent improvement and rolling trends without changing leaderboard scores", async ({ page }) => {
  const errors = await openApp(page);
  await addTeams(page, [["1A", "One"]]);
  await expect(page.locator("#save-state")).toHaveText("");
  await page.evaluate(async () => {
    for (let index = 1; index <= 8; index++) {
      const record = History.practiceRecord(state.history, state.teams, {
        mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([index, 0, 0, 0, 0]),
        occurredAt: `2026-10-${String(index).padStart(2, "0")}T12:00:00Z`,
        notes: "", status: "ok", optIn: false, stopTime: 0,
        runRole: index === 8 ? "member" : "coach"
      });
      state = { ...state, history: [...state.history, record] };
    }
    await persist();
    render();
  });
  await page.click('[data-tab="analysis"]');
  await page.locator('[data-analysis-team="1A"]').click();
  const row = page.locator("#team-analysis-summary tr").nth(1);
  await expect(row.locator("td").nth(1)).toHaveText("8");
  await expect(row.locator("td").nth(2)).toContainText("6.00");
  await expect(row.locator("td").nth(3)).toContainText("+4.00 points");
  await expect(row.locator("td").nth(4)).toHaveText("8.00");
  await expect(row.locator("td").nth(5)).toContainText("8.00");
  await expect(page.locator("#team-analysis-summary").locator("xpath=../thead")).not.toContainText("Standard deviation");
  const trend = page.locator("#team-analysis-trends .team-trend").nth(1);
  const practiceSession = page.locator("#team-analysis-sessions tr").first().locator("td").first();
  await expect(practiceSession).toContainText("Practice /");
  await expect(practiceSession).not.toContainText("practice:");
  await expect(practiceSession).toContainText("2026");
  await expect(trend.locator(".rolling-average")).toHaveCount(1);
  await expect(trend.locator("circle")).toHaveCount(16);
  await expect(trend.locator("svg")).toHaveAttribute("aria-label", /rolling five-run average/);
  await expect(trend.locator("svg")).toContainText("Student practice (not ranked)");
  expect(await page.evaluate(() => History.skillsRanking(state.history, state.teams)[0].driver)).toBe(7);
  await page.selectOption("#analysis-source", "event");
  await expect(row.locator("td").nth(1)).toHaveText("0");
  await expect(row.locator("td").nth(4)).toHaveText("--");
  await expect(trend).toContainText("No dated results yet.");
  expect(errors).toEqual([]);
});

test("posting a match saves score history that survives a reload", async ({ page }) => {
  const errors = await openApp(page);
  await scheduleAndPostFirstMatch(page);
  await expect(page.locator("#footer-history-count")).toContainText("1");
  await page.reload();
  await expect(page.locator("#save-state")).toHaveText("");
  await expect(page.locator("#footer-history-count")).toContainText("1");
  expect(await page.evaluate(() => History.resolve(state.history).length)).toBe(1);
  expect(errors).toEqual([]);
});

test("coaches can promote a student practice run to the leaderboards", async ({ page }) => {
  await openApp(page);
  await addTeams(page, [["1A", "One"], ["2A", "Two"]]);
  const run = await page.evaluate(async () => {
    const entry = History.practiceRecord(state.history, state.teams, {
      runRole: "member", mode: "driver", teams: ["1A"], goals: Core.goalsFromCounts([10, 0, 0, 0, 0]),
      occurredAt: "2026-11-06T12:00:00.000Z", notes: "Student practice", status: "ok", optIn: false, stopTime: 0
    });
    state = { ...state, history: [...state.history, entry] };
    await persist();
    return { id: entry.id, runId: entry.runId };
  });
  expect(await page.evaluate(() => History.skillsRanking(state.history, state.teams).find(team => team.id === "1A").driver)).toBe(0);
  await page.click('[data-tab="practice"]');
  await page.selectOption("#practice-filter", "all");
  const promote = page.locator(`[data-promote-practice="${run.runId}"]`);
  await expect(promote).toBeVisible();
  await page.evaluate(() => { window.__confirmAnswer = null; });
  await promote.click();
  await expect(page.locator("#confirm-message")).toContainText("Promote this student run to coach leaderboards");
  await expect(page.locator("#confirm-message")).toContainText("original student entry will remain in score history");
  await page.click("#confirm-ok");
  await expect(page.locator("#notice-message")).toContainText("Practice run promoted");
  await expect(page.locator(`[data-promote-practice="${run.runId}"]`)).toHaveCount(0);
  const result = await page.evaluate(run => ({
    leaderboard: History.skillsRanking(state.history, state.teams).find(team => team.id === "1A").driver,
    entries: state.history.filter(record => record.runId === run.runId).map(record => [record.id, record.action, record.runRole])
  }), run);
  expect(result.leaderboard).toBe(10);
  expect(result.entries).toHaveLength(2);
  expect(result.entries[0]).toEqual([run.id, "posted", "member"]);
  expect(result.entries[1]).toEqual([expect.any(String), "promoted", "coach"]);
});

test("End event clears the active schedule and results but keeps teams and posted history", async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator("#generate")).toHaveText("Start event");
  await expect(page.locator("#generate")).toBeVisible();
  await expect(page.locator("#clear-schedule")).toBeHidden();
  await scheduleAndPostFirstMatch(page);
  await page.click('[data-tab="setup"]');
  await expect(page.locator("#clear-schedule")).toHaveText("End event");
  await expect(page.locator("#clear-schedule")).toBeVisible();
  await expect(page.locator("#generate")).toBeHidden();
  await page.evaluate(() => { window.__confirmAnswer = null; });
  await page.click("#clear-schedule");
  await expect(page.locator("#confirm-message")).toContainText("End this event?");
  await expect(page.locator("#confirm-ok")).toHaveText("End event");
  await page.click("#confirm-ok");
  await expect(page.locator("#generate")).toBeVisible();
  await expect(page.locator("#clear-schedule")).toBeHidden();
  await expect(page.locator("#notice-message")).toContainText("Event ended");
  expect(await page.evaluate(() => ({
    teams: state.teams.map(team => team.id),
    matches: state.matches.length,
    postedResults: state.matches.filter(match => match.result).length,
    history: History.resolve(state.history).length,
    selected: state.selected
  }))).toEqual({ teams: ["1A", "2A", "3A", "4A"], matches: 0, postedResults: 0, history: 1, selected: null });
  expect(errors).toEqual([]);
});

test("removing a posted match warns that unposted edits will be discarded", async ({ page }) => {
  await openApp(page);
  await scheduleAndPostFirstMatch(page);
  await page.evaluate(() => { window.__confirmAnswer = false; });
  await page.locator('#scoring-inputs [data-step="1"]').first().click();
  await page.click("#clear-result");
  await expect(page.locator("#confirm-dialog")).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => window.__confirms.at(-1))).toContain("unposted edits to this match will also be discarded");
  await expect(page.locator("#match-status")).toHaveText("Posted");
});

test("confirmations use the in-app dialog: Escape cancels and the action button confirms", async ({ page }) => {
  const errors = await openApp(page);
  await scheduleAndPostFirstMatch(page);
  await page.evaluate(() => { window.__confirmAnswer = null; });
  const counts = () => page.locator("#scoring-inputs [data-goal-path]").evaluateAll(inputs => inputs.map(input => input.value).join(","));
  const before = await counts();
  await page.click("#reset-score");
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await expect(page.locator("#confirm-message")).toContainText("Reset all field bag counts?");
  await expect(page.locator("#confirm-ok")).toHaveText("Reset counts");
  await expect(page.locator("#confirm-cancel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#confirm-dialog")).toBeHidden();
  expect(await counts()).toBe(before);
  await page.click("#reset-score");
  await page.click("#confirm-ok");
  await expect(page.locator("#confirm-dialog")).toBeHidden();
  await expect.poll(counts).not.toBe(before);
  expect(errors).toEqual([]);
});

test("a stale tab cannot overwrite newer scores saved by another tab", async ({ page, context }) => {
  await openApp(page);
  const other = await context.newPage();
  await openApp(other);
  // Background tabs are throttled, so bring each tab forward before driving it.
  await page.bringToFront();
  await scheduleAndPostFirstMatch(page);
  await other.bringToFront();
  await expect(other.locator("#notice-message")).toContainText("changed in another browser tab");
  expect(await other.evaluate(async () => { state.name = "Stale"; return persist(); })).toBe(false);
  await expect(other.locator("main")).toHaveJSProperty("inert", true);
  await page.bringToFront();
  await page.reload();
  await expect(page.locator("#save-state")).toHaveText("");
  expect(await page.evaluate(() => [state.name, History.resolve(state.history).length])).toEqual(["Local teamwork", 1]);
  await other.bringToFront();
  await other.evaluate(() => document.getElementById("reload-shared").click());
  await expect(other.locator("main")).toHaveJSProperty("inert", false);
  expect(await other.evaluate(() => History.resolve(state.history).length)).toBe(1);
});

test("Back walks through tabs, then asks before leaving the app", async ({ page }) => {
  await openApp(page);
  await page.click('[data-tab="practice"]');
  await page.click('[data-tab="skills"]');
  await page.goBack();
  await expect(page.locator('[data-tab="practice"]')).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page.locator('[data-tab="setup"]')).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page.locator("#leave-dialog")).toBeVisible();
  await expect(page.locator("#leave-dialog-message")).toContainText("leave this app");
});

test("team names are displayed as text on every tab, never executed", async ({ page }) => {
  const errors = await openApp(page);
  const payload = '<img src=x onerror="window.__injected=1">';
  await addTeams(page, [["1A", payload], ["2A", "Two"]]);
  for (const tab of ["setup", "control", "rankings", "skills", "skills-rankings", "practice", "rubric", "interview", "analysis"]) {
    await page.click(`[data-tab="${tab}"]`);
    await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator("#roster")).toContainText(payload);
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("rubric guidance tiles show descriptions and set or clear score values", async ({ page }) => {
  await openApp(page);
  await addTeams(page, [["1A", "One"]]);
  await page.click('[data-tab="rubric"]');
  await page.selectOption("#rubric-team", "1A");
  await expect(page.locator("#notebook-guidance-summary")).toHaveCount(0);
  await expect(page.locator("#rubric-form [data-rubric-display]")).toHaveCount(0);
  await expect(page.locator("#rubric-help-navigation")).toHaveCount(0);
  const headings = page.locator("#rubric-criteria .rubric-section-title");
  await expect(headings).toHaveText([
    "Notebook Organization",
    "Engineering Design Process – Define",
    "Engineering Design Process – Develop Solutions",
    "Engineering Design Process – Optimize",
    "Engineering Design Process – Reflection and Iteration"
  ]);
  await page.selectOption("#notebook-guidance-version", "student");
  await expect(headings).toHaveText([
    "Is our notebook easy to use?",
    "Did we explain the problem? – Define",
    "Did we build, test, and decide? – Develop Solutions",
    "Did we make it better? – Optimize",
    "Did we try and learn again? – Reflection and Iteration"
  ]);
  await expect(page.locator("#rubric-criteria select")).toHaveCount(0);
  await expect(page.locator('#rubric-criteria input[type="hidden"][id^="rubric-score-"]')).toHaveCount(16);
  await expect(page.locator("#rubric-note-navigation").locator("xpath=..")).toContainText("Evidence / notes");
  await expect(page.locator("#rubric-note-navigation")).toHaveAttribute("aria-label", /^Evidence and notes for /);
  const guidance = page.locator("#rubric-guidance-navigation");
  await expect(guidance).toBeVisible();
  await expect(guidance.locator(".rubric-guidance-score")).toHaveText(["4", "3", "2", "1"]);
  await expect(guidance.locator(".rubric-guidance-level-label strong")).toHaveCount(0);
  expect(await guidance.locator(".rubric-guidance-levels").evaluate(list => getComputedStyle(list).gridTemplateColumns.split(/\s+/).length)).toBe(4);
  const headingBox = await guidance.locator("xpath=..").locator(".rubric-criterion-heading").boundingBox();
  const guidanceBox = await guidance.boundingBox();
  expect(guidanceBox.x).toBeGreaterThan(headingBox.x);
  const notesToggle = page.locator('#rubric-form [data-rubric-evidence-notes]');
  const notesField = page.locator("#rubric-note-navigation").locator("xpath=..");
  await expect(notesToggle).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Review with notes" })).toBeVisible();
  await expect(notesToggle.locator("xpath=../..")).toHaveClass(/rubric-form-heading/);
  await page.locator("#rubric-note-navigation").fill("Keep this note while hidden.");
  await notesToggle.uncheck();
  await expect(notesField).toBeHidden();
  await expect(page.locator("#rubric-note-navigation")).toHaveValue("Keep this note while hidden.");
  await notesToggle.check();
  await expect(notesField).toBeVisible();
  await expect(page.locator("#rubric-note-navigation")).toHaveValue("Keep this note while hidden.");
  const score = page.locator("#rubric-score-navigation");
  const ratingThree = guidance.locator('[data-guidance-score="3"]');
  await ratingThree.click();
  await expect(score).toHaveValue("3");
  await expect(ratingThree).toHaveAttribute("aria-pressed", "true");
  await ratingThree.click();
  await expect(score).toHaveValue("");
  await expect(ratingThree).toHaveAttribute("aria-pressed", "false");
});
