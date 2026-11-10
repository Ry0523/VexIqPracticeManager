"use strict";
const { test, expect } = require("@playwright/test");

const { openApp, addTeams } = require("./helpers.js");

test("notebook and interview rating choices are readable and selectable on phones", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const errors = await openApp(page);
  await addTeams(page, [["1A", "One"]]);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [tab, criterion, rating] of [["rubric", "navigation", "3"], ["interview", "own-work", "2"]]) {
      await page.click(`[data-tab="${tab}"]`);
      await expect(page.locator(`#${tab}-criteria .rubric-sample-questions`)).toHaveCount(tab === "rubric" ? 0 : 6);
      if (tab === "rubric") continue;
      const sampleQuestions = page.locator(`#${tab}-criteria .rubric-sample-questions`).first();
      await expect(sampleQuestions).toHaveCount(1);
      await sampleQuestions.locator("summary").click();
      await expect(sampleQuestions.locator("li")).toHaveCount(2);
      const guidance = page.locator(`#${tab}-guidance-${criterion}`);
      const layout = await guidance.evaluate(element => {
        const list = element.querySelector(".rubric-guidance-levels");
        const buttons = [...list.querySelectorAll("button")];
        const rectangles = buttons.map(button => button.getBoundingClientRect());
        return {
          scrollWidth: list.scrollWidth,
          clientWidth: list.clientWidth,
          fontSize: parseFloat(getComputedStyle(buttons[0].querySelector(".rubric-guidance-description")).fontSize),
          stacked: rectangles.every((rectangle, index) => !index || rectangle.top >= rectangles[index - 1].bottom),
          minHeight: Math.min(...rectangles.map(rectangle => rectangle.height)),
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        };
      });
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.fontSize).toBeGreaterThanOrEqual(14);
      expect(layout.stacked).toBe(true);
      expect(layout.minHeight).toBeGreaterThanOrEqual(48);
      expect(layout.pageOverflow).toBe(false);
      await guidance.locator(`[data-guidance-score="${rating}"]`).click();
      await expect(page.locator(`#${tab}-score-${criterion}`)).toHaveValue(rating);
      await guidance.locator(`[data-guidance-score="${rating}"]`).click();
    }
  }
  expect(errors).toEqual([]);
});

test("notebook guidance source switches and persists on this device", async ({ page }) => {
  await openApp(page);
  await addTeams(page, [["1A", "One"]]);
  await page.click('[data-tab="rubric"]');
  await page.selectOption("#rubric-team", "1A");
  const version = page.locator("#notebook-guidance-version");
  const link = page.locator("#notebook-guidance-link");
  const guidance = page.locator("#rubric-guidance-navigation");
  const score = page.locator("#rubric-score-navigation");
  const criterionTitle = page.locator('label[for="rubric-score-navigation"]');
  const preparation = page.locator("#notebook-preparation");
  await expect(preparation.locator("summary")).toHaveText("Preparing your notebook");
  await preparation.locator("summary").click();
  await expect(preparation).toContainText("Date and organize entries");
  await expect(preparation).toContainText("what you learned");
  await expect(version).toHaveValue("official");
  await expect(criterionTitle).toHaveText("Information is easy to reference");
  await expect(link).toHaveAttribute("href", /engineering-notebook-rubric-A4-v2\.0\.pdf$/);
  await expect(guidance).toBeVisible();
  await expect(guidance.locator(".rubric-guidance-description").first()).toHaveText("Pages are numbered, entries are ordered chronologically or by section, and a table of contents leads to specific entries.");
  await expect(guidance.locator(".rubric-guidance-option")).toHaveCount(4);
  await expect(score).toHaveAttribute("type", "hidden");
  await expect(page.locator("#rubric-criteria select")).toHaveCount(0);
  await guidance.locator('[data-guidance-score="3"]').click();
  await expect(score).toHaveValue("3");
  await guidance.locator('[data-guidance-score="3"]').click();
  await expect(score).toHaveValue("");

  await version.selectOption("student");
  await expect(criterionTitle).toHaveText("Finding things");
  await expect(page.locator('label[for="rubric-score-changes"]')).toHaveText("Why we changed things");
  await expect(link).toHaveAttribute("href", /student-friendly-engineering-notebook-rubric-a4-v2\.0\.pdf$/);
  await expect(link).toHaveText("Open Student-friendly rubric PDF");
  await expect(guidance.locator(".rubric-guidance-description").first()).toHaveText("Our pages are numbered, our entries are in order (by date or by section), and our table of contents points to the exact page.");
  await expect(guidance.locator(".rubric-guidance-score")).toHaveText(["4", "3", "2", "1"]);
  await expect(guidance.locator(".rubric-guidance-level-label strong")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#save-state")).toHaveText("");
  await page.click('[data-tab="rubric"]');
  await expect(version).toHaveValue("student");
  await expect(link).toHaveAttribute("href", /student-friendly-engineering-notebook-rubric-a4-v2\.0\.pdf$/);
  await expect(guidance.locator(".rubric-guidance-description").first()).toHaveText("Our pages are numbered, our entries are in order (by date or by section), and our table of contents points to the exact page.");
  await expect(guidance.locator(".rubric-guidance-score")).toHaveText(["4", "3", "2", "1"]);
  await expect(guidance.locator(".rubric-guidance-level-label strong")).toHaveCount(0);
});

test("interview guidance source switches and persists independently from notebook", async ({ page }) => {
  await openApp(page);
  await addTeams(page, [["1A", "One"]]);
  await page.click('[data-tab="interview"]');
  await page.selectOption("#interview-team", "1A");
  const version = page.locator("#interview-guidance-version");
  const link = page.locator("#interview-guidance-link");
  const title = page.locator('label[for="interview-score-own-work"]');
  const guidance = page.locator("#interview-guidance-own-work");
  const adaptationGuidance = page.locator("#interview-guidance-adaptation");
  const preparation = page.locator("#interview-preparation");

  await expect(preparation.locator("summary")).toHaveText("Preparing for the interview");
  await preparation.locator("summary").click();
  await expect(preparation).toContainText("short, friendly conversation, not a test");
  await expect(preparation).toContainText("No one person needs to know everything");

  await expect(version).toHaveValue("official");
  await expect(link).toHaveAttribute("href", /team-interview-rubric-A4-v2\.0\.pdf$/);
  await expect(title).toHaveText("Students explain their own work");
  await expect(guidance.locator('[data-guidance-score="2"] .rubric-guidance-bullets li')).toHaveText([
    "How a part of the robot, code, or strategy works.",
    "Questions land with the student who can answer - no one has to explain everything.",
    "Why the team built it that way.",
    "What they chose it over."
  ]);
  await expect(page.locator("#interview-criteria .rubric-section-title").first()).toHaveText("Explain your learning");

  await version.selectOption("student");
  await expect(link).toHaveAttribute("href", /student-friendly-team-interview-rubric-a4-v2\.0\.pdf$/);
  await expect(link).toHaveText("Open Student-friendly rubric PDF");
  await expect(title).toHaveText("Explaining our own work");
  await expect(guidance.locator('[data-guidance-score="2"] .rubric-guidance-description')).toHaveText("We can each pick a part of our robot, code, or game plan and explain how it works, why we built it that way, and what we picked it over.");
  await expect(adaptationGuidance.locator('[data-guidance-score="2"] .rubric-guidance-description p')).toHaveText("When we borrow an idea from another team, a video, or a coach, we can say:");
  await expect(adaptationGuidance.locator('[data-guidance-score="2"] .rubric-guidance-bullets li')).toHaveText([
    "Where it came from.",
    "What we changed to fit our robot.",
    "How we tested it.",
    "Why it works."
  ]);
  await expect(adaptationGuidance.locator('[data-guidance-score="2"] .rubric-guidance-bullets li').first()).toHaveCSS("display", "list-item");
  await expect(page.locator("#interview-criteria .rubric-section-title").first()).toHaveText("How We Explain Our Work");

  await page.click('[data-tab="rubric"]');
  await expect(page.locator("#notebook-guidance-version")).toHaveValue("official");
  await page.reload();
  await expect(page.locator("#save-state")).toHaveText("");
  await page.click('[data-tab="interview"]');
  await expect(version).toHaveValue("student");
  await expect(title).toHaveText("Explaining our own work");
});

test("coach can expand saved notebook review notes from the review list", async ({ page }) => {
  await openApp(page);
  await addTeams(page, [["1A", "One"]]);
  await page.click('[data-tab="rubric"]');
  await page.fill("#rubric-date", "2026-11-05");
  await page.fill("#rubric-reviewer", "Coach");
  await page.locator('#rubric-guidance-navigation [data-guidance-score="3"]').click();
  await page.locator("#rubric-note-navigation").fill("Clear page numbers and a working contents page.");
  await page.click("#save-rubric");

    await expect(page.locator("#rubric-previous-score-navigation")).toHaveText("Previous: 3/4");
    const earlierNoteToggle = page.locator("#rubric-previous-note-toggle-navigation");
    const earlierNote = page.locator("#rubric-previous-navigation");
    await expect(earlierNoteToggle).toBeVisible();
    const formHeight = await page.locator("#rubric-form").evaluate(form => form.getBoundingClientRect().height);
    await earlierNoteToggle.click();
    await expect(earlierNote).toBeVisible();
    await expect(earlierNote).toContainText("Earlier note (2026-11-05): Clear page numbers and a working contents page.");
    expect(await page.locator("#rubric-form").evaluate(form => form.getBoundingClientRect().height)).toBe(formHeight);

  const toggle = page.getByRole("button", { name: "View notes for the notebook review from 2026-11-05" });
  await expect(toggle).toBeVisible();
  const actions = [toggle, page.getByRole("button", { name: "Edit notebook review from 2026-11-05" }), page.getByRole("button", { name: "Delete notebook review from 2026-11-05" })];
  const topOffsets = await Promise.all(actions.map(async button => (await button.boundingBox()).y));
  expect(Math.max(...topOffsets) - Math.min(...topOffsets)).toBeLessThan(2);
  await toggle.click();
  await expect(page.locator("#rubric-history-rows .review-notes")).toContainText("Clear page numbers and a working contents page.");
  await expect(page.locator("#rubric-history-rows .review-notes")).toContainText("Information is easy to reference");
});

test("interview reviews build a history; the current score uses each criterion's latest review", async ({ page }) => {
  const errors = await openApp(page);
  await addTeams(page, [["1A", "One"]]);
  await page.click('[data-tab="rubric"]');
  await expect(page.locator("#export-rubrics")).toHaveCount(0);
  await page.click('[data-tab="interview"]');
  await expect(page.locator("#export-interviews")).toHaveCount(0);
  const scores = page.locator('#interview-criteria input[type="hidden"][id^="interview-score-"]');
  const history = page.locator("#interview-history-rows tr");
  await expect(scores).toHaveCount(6);
  const chooseScore = async (index, value) => {
    const id = await scores.nth(index).getAttribute("id");
    await page.locator(`.rubric-guidance-option[data-guidance-for="${id}"][data-guidance-score="${value}"]`).click();
  };

  await page.fill("#interview-date", "2026-10-29");
  await page.fill("#interview-reviewer", "Coach");
  for (let index = 0; index < 6; index++) await chooseScore(index, "2");
  await page.locator("#interview-criteria textarea").first().fill("Clear design story");
  await page.click("#save-interview");
  await expect(history).toHaveCount(1);
  await expect(page.locator("#interview-current")).toContainText("12 / 12");
  await expect(page.locator("#interview-form-title")).toHaveText("New review");
  await expect(scores.first()).toHaveValue("");

  // A targeted follow-up review scores two criteria; the others keep their earlier scores.
  await expect(page.locator("#interview-previous-score-own-work")).toHaveText("Previous: 2/2");
  const interviewNoteToggle = page.locator("#interview-previous-note-toggle-own-work");
  const interviewNote = page.locator("#interview-previous-own-work");
  await expect(interviewNoteToggle).toBeVisible();
  await interviewNoteToggle.click();
  await expect(interviewNote).toContainText("Earlier note (2026-10-29): Clear design story");
  await page.fill("#interview-date", "2026-11-05");
  await chooseScore(0, "0");
  await chooseScore(1, "0");
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
  await chooseScore(2, "1");
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
