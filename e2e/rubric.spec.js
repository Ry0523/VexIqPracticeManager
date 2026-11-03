"use strict";
const { test, expect } = require("@playwright/test");

const { openApp, addTeams } = require("./helpers.js");

test("interview reviews build a history; the current score uses each criterion's latest review", async ({ page }) => {
  const errors = await openApp(page);
  await addTeams(page, [["1A", "One"]]);
  await page.click('[data-tab="interview"]');
  const scores = page.locator("#interview-criteria select");
  const history = page.locator("#interview-history-rows tr");
  await expect(scores).toHaveCount(6);

  await page.fill("#interview-date", "2026-10-29");
  await page.fill("#interview-reviewer", "Coach");
  for (let index = 0; index < 6; index++) await scores.nth(index).selectOption("2");
  await page.locator("#interview-criteria textarea").first().fill("Clear design story");
  await page.click("#save-interview");
  await expect(history).toHaveCount(1);
  await expect(page.locator("#interview-current")).toContainText("12 / 12");
  await expect(page.locator("#interview-form-title")).toHaveText("New review");
  await expect(scores.first()).toHaveValue("");

  // A targeted follow-up review scores two criteria; the others keep their earlier scores.
  await expect(page.locator("#interview-criteria .rubric-previous").first()).toContainText("Earlier score: 2 (2026-10-29)");
  await expect(page.locator("#interview-criteria .rubric-previous").first()).toContainText("Clear design story");
  await page.fill("#interview-date", "2026-11-05");
  await scores.nth(0).selectOption("0");
  await scores.nth(1).selectOption("0");
  await page.click("#save-interview");
  await expect(history).toHaveCount(2);
  await expect(page.locator("#interview-current")).toContainText("8 / 12, 6 / 6 criteria scored");
  await expect(page.locator("#interview-rows tr").first()).toContainText("2026-11-05");
  await expect(page.locator("#interview-rows tr td").nth(3)).toHaveText("2");

  await page.reload();
  await expect(page.locator("#save-state")).toHaveText("");
  await page.click('[data-tab="interview"]');
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText("2026-11-05");
  await expect(history.nth(1)).toContainText("2026-10-29");

  // Editing the earlier review changes only that review.
  await page.getByRole("button", { name: "Edit interview review from 2026-10-29" }).click();
  await expect(page.locator("#interview-form-title")).toHaveText("Editing review from 2026-10-29");
  await expect(page.locator("#save-interview")).toHaveText("Save changes");
  await expect(scores.nth(2)).toHaveValue("2");
  await scores.nth(2).selectOption("1");
  await page.click("#save-interview");
  await expect(history).toHaveCount(2);
  await expect(page.locator("#interview-current")).toContainText("7 / 12");
  await expect(page.locator("#interview-form-title")).toHaveText("New review");

  await page.getByRole("button", { name: "Delete interview review from 2026-11-05" }).click();
  await expect(history).toHaveCount(1);
  await expect(page.locator("#interview-current")).toContainText("11 / 12");
  expect(await page.evaluate(() => state.interviews.length)).toBe(1);
  expect(errors).toEqual([]);
});
