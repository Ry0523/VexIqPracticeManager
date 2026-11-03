"use strict";
const { test, expect } = require("@playwright/test");

const { openApp, addTeams } = require("./helpers.js");

async function scheduleAndPostFirstMatch(page) {
  await addTeams(page, [["1A", "One"], ["2A", "Two"], ["3A", "Three"], ["4A", "Four"]]);
  await page.locator("#schedule-form button[type=submit]").click();
  await page.locator('#scoring-inputs [data-step="1"]').first().click();
  await page.click("#save-score");
  await expect(page.locator("#match-status")).toHaveText("Posted");
}

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

test("every rubric score control has a distinct accessible name", async ({ page }) => {
  await openApp(page);
  const names = await page.locator("#rubric-criteria select").evaluateAll(selects => selects.map(select => select.getAttribute("aria-label")));
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names).size).toBe(names.length);
  expect(names.every(name => name.startsWith("Points for "))).toBe(true);
});
