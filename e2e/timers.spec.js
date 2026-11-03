"use strict";
const { test, expect } = require("@playwright/test");
const { openApp, addTeams, schedule, useFakeTimerClock } = require("./helpers.js");

const teams = [["1A", "One"], ["2A", "Two"], ["3A", "Three"], ["4A", "Four"]];

test.beforeEach(async ({ page }) => { await useFakeTimerClock(page); });

test("match timer counts down through the start countdown, driver switch window, pause, and end", async ({ page }) => {
  const errors = await openApp(page);
  await schedule(page, teams, 1);
  // Reset is only available once a stopped timer has moved off the full minute.
  await expect(page.locator("#reset-timer")).toBeDisabled();
  await page.click("#start-timer");
  await expect(page.locator("#timer-label")).toHaveText("STARTING IN 3");
  await expect(page.locator("#start-timer")).toHaveText("Pause match");
  await expect(page.locator("#reset-timer")).toBeDisabled();
  // Beats are 0.75 s apart, then the run starts at 1:00.
  await page.clock.fastForward(800);
  await expect(page.locator("#timer-label")).toHaveText("STARTING IN 2");
  await page.clock.fastForward(750);
  await expect(page.locator("#timer-label")).toHaveText("STARTING IN 1");
  await page.clock.fastForward(700);
  await expect(page.locator("#timer-label")).toHaveText("MATCH IN PROGRESS");
  await expect(page.locator("#timer")).toHaveText("01:00");
  await expect(page.locator("#reset-timer")).toBeDisabled();

  // Resetting a paused run needs no confirmation.
  await page.clock.fastForward(1000);
  await page.click("#start-timer");
  await expect(page.locator("#timer-label")).toHaveText("MATCH PAUSED");
  await expect(page.locator("#reset-timer")).toBeEnabled();
  await page.click("#reset-timer");
  await expect(page.locator("#timer-label")).toHaveText("READY FOR MATCH");
  await expect(page.locator("#reset-timer")).toBeDisabled();
  await page.click("#start-timer");

  await page.clock.fastForward(3100 + 26000);
  await expect(page.locator("#timer-label")).toHaveText("DRIVER SWITCH WINDOW");

  await page.click("#start-timer");
  await expect(page.locator("#timer-label")).toHaveText("MATCH PAUSED");
  const paused = await page.locator("#timer").textContent();
  await page.clock.fastForward(5000);
  await expect(page.locator("#timer")).toHaveText(paused);

  await page.click("#start-timer");
  await expect(page.locator("#timer-label")).toHaveText("DRIVER SWITCH WINDOW");
  await page.clock.fastForward(10000);
  await expect(page.locator("#timer-label")).toHaveText("MATCH IN PROGRESS");
  await page.clock.fastForward(25000);
  await expect(page.locator("#timer-label")).toHaveText("MATCH COMPLETE");
  await expect(page.locator("#start-timer")).toBeDisabled();

  await page.click("#reset-timer");
  await expect(page.locator("#timer-label")).toHaveText("READY FOR MATCH");
  await expect(page.locator("#reset-timer")).toBeDisabled();
  expect(await page.evaluate(() => window.__confirms)).toEqual([]);
  expect(errors).toEqual([]);
});

test("full-screen flow runs, scores, and posts each match, then exits after the last one", async ({ page }) => {
  await openApp(page);
  await schedule(page, teams, 1);
  const flow = page.locator(".field-control");

  await page.click("#fullscreen");
  await expect(flow).toHaveClass(/flow-mode/);
  await expect(flow).toHaveAttribute("data-flow-step", "timer");
  await expect(page.locator("#flow-next")).toHaveText("Post & next match \u2192");

  await page.click("#start-timer");
  await page.clock.fastForward(64000);
  await expect(page.locator("#timer-label")).toHaveText("MATCH COMPLETE");

  await page.click("#flow-score");
  await expect(flow).toHaveAttribute("data-flow-step", "score");
  await page.locator('#scoring-inputs [data-step="1"]').first().click();
  await page.click("#flow-next");

  await expect(flow).toHaveClass(/flow-mode/);
  await expect(flow).toHaveAttribute("data-flow-step", "timer");
  await expect(page.locator("#timer-label")).toHaveText("READY FOR MATCH");
  await expect(page.locator("#flow-next")).toHaveText("Post & exit full screen");

  await page.click("#flow-score");
  await page.locator('#scoring-inputs [data-step="1"]').first().click();
  await page.locator('#scoring-inputs [data-step="1"]').first().click();
  await page.click("#flow-next");

  await expect(flow).not.toHaveClass(/flow-mode/);
  expect(await page.evaluate(() => state.matches.map(match => Boolean(match.result)))).toEqual([true, true]);
  expect(await page.evaluate(() => History.resolve(state.history).length)).toBe(2);
});

test("full-screen practice shows the timer and scoring on one page and posts each run before the next", async ({ page }) => {
  const errors = await openApp(page);
  await addTeams(page, [["1A", "One"], ["2A", "Two"]]);
  await page.click('[data-tab="practice"]');
  const form = page.locator("#practice-form");
  await page.click("#practice-fullscreen");
  await expect(form).toHaveClass(/flow-mode/);
  await expect(page.locator("#practice-flow-label")).toHaveText("Practice run \u00b7 Driver skills \u00b7 1A");
  await expect(page.locator("#practice-timer")).toBeInViewport();
  await expect(page.locator("#practice-scoring-inputs")).toBeVisible();
  await expect(page.locator("#practice-flow-next")).toHaveText("Next run \u2192");
  await expect(page.locator("#new-practice-bottom")).toBeHidden();

  await page.click("#start-practice");
  await page.clock.fastForward(2240 + 60000);
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE RUN ENDED");
  await page.locator('#practice-scoring-inputs [data-step="1"]').first().click();
  await expect(page.locator("#practice-flow-next")).toHaveText("Post & next run \u2192");
  await expect(page.locator("#new-practice-bottom")).toHaveText("Discard & next run");
  await page.click("#practice-flow-next");
  await expect(page.locator("#practice-timer-label")).toHaveText("READY FOR PRACTICE");
  await expect(page.locator("#practice-score-total")).toHaveText("0");
  await expect(form).toHaveClass(/flow-mode/);
  expect(await page.evaluate(() => History.resolve(state.history).filter(record => record.source === "practice").length)).toBe(1);
  await expect(page.locator("#practice-date")).toHaveCount(0);
  expect(await page.evaluate(() => Number.isFinite(Date.parse(History.resolve(state.history).find(record => record.source === "practice").occurredAt)))).toBe(true);

  await expect(page.locator("#start-practice")).toBeEnabled();
  await page.click("#start-practice");
  await page.clock.fastForward(2240 + 5000);
  await expect(page.locator("#practice-timer")).toHaveText("00:55");
  await page.clock.fastForward(55000);
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE RUN ENDED");
  await page.click("#practice-flow-next");
  await expect(page.locator("#practice-timer-label")).toHaveText("READY FOR PRACTICE");

  await page.click("#practice-flow-exit");
  await expect(form).not.toHaveClass(/flow-mode/);
  await expect(page.locator("#new-practice-bottom")).toHaveText("Next run");
  await expect(page.locator("#practice-runs tr")).toHaveCount(2);
  await expect(page.locator("#practice-runs")).toContainText("Coach run");
  await expect(page.locator("#practice-ranking-note")).toContainText("counts toward leaderboards");
  await page.click("#practice-fullscreen");
  await expect(form).toHaveClass(/flow-mode/);
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await page.keyboard.press("Escape");
  await expect(form).not.toHaveClass(/flow-mode/);
  expect(errors).toEqual([]);
});

test("full-screen flow can be left with the exit button and Escape without posting", async ({ page }) => {
  await openApp(page);
  await schedule(page, teams, 1);
  const flow = page.locator(".field-control");
  await page.click("#fullscreen");
  await page.click("#flow-exit");
  await expect(flow).not.toHaveClass(/flow-mode/);
  await page.click("#fullscreen");
  await expect(flow).toHaveClass(/flow-mode/);
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await page.keyboard.press("Escape");
  await expect(flow).not.toHaveClass(/flow-mode/);
  expect(await page.evaluate(() => state.matches.some(match => match.result))).toBe(false);
});

async function openSkills(page) {
  await addTeams(page, teams.slice(0, 2));
  await page.click('[data-tab="skills"]');
  await page.check("#skills-only");
  await expect(page.locator("#skills-eligibility")).toHaveText("Skills-only event");
}

test("ending a driver skills run early records the stop time with the posted attempt", async ({ page }) => {
  const errors = await openApp(page);
  await openSkills(page);
  await page.check("#skills-opt-in");
  await page.click("#start-skills");
  await expect(page.locator("#skills-timer-label")).toHaveText("STARTING IN 3");
  await expect(page.locator("#start-skills")).toHaveText("End run");
  await expect(page.locator("#skills-opt-in")).toBeDisabled();
  await expect(page.locator("#save-skills")).toBeDisabled();

  await page.clock.fastForward(2240 + 26000);
  await expect(page.locator("#skills-timer-label")).toHaveText("DRIVER SWITCH WINDOW");
  await page.clock.fastForward(5000);
  await page.click("#start-skills");
  await expect(page.locator("#skills-timer-label")).toHaveText("SKILLS RUN ENDED");
  await expect(page.locator("#skills-stop-time")).toHaveValue("29");

  await page.locator('#skills-scoring-inputs [data-step="1"]').first().click();
  await expect(page.locator("#save-skills")).toBeEnabled();
  await page.click("#save-skills");
  await expect(page.locator('[data-open-skills-mode="driver"][data-open-skills-attempt="1"]')).not.toContainText("--");
  expect(await page.evaluate(() => state.skills.map(({ team, mode, attempt, stopTime }) => ({ team, mode, attempt, stopTime })))).toEqual([{ team: "1A", mode: "driver", attempt: 1, stopTime: 29 }]);
  expect(await page.evaluate(() => History.resolve(state.history).filter(record => record.kind === "skills").length)).toBe(1);
  expect(errors).toEqual([]);
});

test("autonomous skills runs have no driver switch window and run to zero", async ({ page }) => {
  await openApp(page);
  await openSkills(page);
  await page.click('[data-open-skills-mode="autonomous"][data-open-skills-attempt="1"]');
  await expect(page.locator("#skills-heading")).toHaveText("Autonomous / Attempt 1 of 3");
  await page.click("#start-skills");
  await page.clock.fastForward(3100 + 30000);
  await expect(page.locator("#skills-timer-label")).toHaveText("SKILLS RUN IN PROGRESS");
  await page.clock.fastForward(31000);
  await expect(page.locator("#skills-timer-label")).toHaveText("SKILLS RUN ENDED");
  await expect(page.locator("#skills-stop-time")).toHaveValue("0");
  await expect(page.locator("#start-skills")).toBeDisabled();
  await expect(page.locator("#reset-skills-timer")).toBeEnabled();
  await page.click("#reset-skills-timer");
  await expect(page.locator("#skills-timer-label")).toHaveText("READY FOR SKILLS");
  await expect(page.locator("#reset-skills-timer")).toBeDisabled();
});
