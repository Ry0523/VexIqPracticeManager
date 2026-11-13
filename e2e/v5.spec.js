"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { useFakeTimerClock } = require("./helpers.js");

test("V5 practice bundle exposes only practice and reviews with mode-specific scoring", async ({ page }) => {
  const project = path.resolve(__dirname, "..");
  execFileSync(process.execPath, ["build-apps-script.js", "override"], { cwd: project });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await useFakeTimerClock(page);
  await page.addInitScript(() => {
    let storage;
    Object.defineProperty(window, "EventStorage", {
      configurable: true,
      get: () => storage,
      set: (value) => {
        storage = value;
        value.loadOfficialSkillsStandings = async () => {
          window.__standingsRefreshCount = (window.__standingsRefreshCount || 0) + 1;
          if (window.__failStandingsRefresh) throw new Error("VEX is unavailable");
          return {
            ok: true,
            capturedAt: "2026-11-11",
            sourceUrl: "https://events.vex.com/",
            teams: {
              "4810Z": {
                gradeLevel: "Middle School",
                row: 2,
                rank: 405,
                score: 37,
                autonomous: 9,
                driver: 28,
                highestAutonomous: 9,
                highestDriver: 28,
              },
              "6008G": {
                gradeLevel: "High School",
                row: 12,
                rank: 250,
                score: 106,
                autonomous: 18,
                driver: 88,
                highestAutonomous: 18,
                highestDriver: 88,
                sourceUrl: "https://events.vex.com/?search=6008G",
              },
            },
          };
        };
      },
    });
  });
  await page.goto("/apps-script/dist-v5/Index.html");
  const gameField = page.locator("[data-game-field]");
  await expect(gameField).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect.poll(() => gameField.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  const allianceStyleRules = await page
    .locator("style")
    .evaluateAll((styles) =>
      styles.reduce(
        (count, style) => count + (style.textContent.match(/\.v5-alliance-score\s*\{/g) || []).length,
        0,
      ),
    );
  expect(allianceStyleRules).toBe(2);
  await expect(page.locator("#save-state")).toHaveText("");
  await expect(page.locator("nav.tabs button:not([hidden])")).toHaveCount(5);
  await expect(page.locator("[data-tab=control]")).toBeHidden();
  await expect(page.locator("#setup-view .schedule-builder")).toBeHidden();
  await expect(page.locator("[data-game-disclaimer]")).toContainText("VEX V5");

  await page.click("#open-settings");
  await page.uncheck("#timer-countdown");
  await page.click("#close-settings");
  await page.click('[data-tab="practice"]');
  await expect(page.locator("#start-practice")).toBeEnabled();
  await expect(page.locator("#save-practice")).toBeDisabled();
  await page.click("#start-practice");
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE IN PROGRESS");
  await page.click("#stop-practice");
  await page.click("#reset-practice-timer");

  await page.click('[data-tab="setup"]');
  for (const [id, name] of [
    ["1A", "Red One"],
    ["2A", "Red Two"],
    ["3A", "Blue One"],
    ["4A", "Blue Two"],
    ["4810Z", "Zigzag"],
    ["6008G", "G-Force"],
  ]) {
    await page.fill("#team-id", id);
    await page.fill("#team-name", name);
    await page.click("#save-team");
  }
  await page.evaluate(() => {
    const storage = EventStorage;
    const access = storage.access;
    Object.defineProperty(storage, "access", {
      configurable: true,
      get: () => ({ ...access, team: "4810Z" }),
    });
  });
  await page.click('[data-tab="practice"]');
  await page.selectOption("#practice-mode", "teamwork");
  await expect(page.locator("#practice-team")).toHaveValue("4810Z");
  await expect(page.locator("#practice-timer")).toHaveText("0:15");
  await expect(
    page
      .locator(".v5-alliance-score.red")
      .evaluate((element) => [...element.children].map((child) => child.tagName)),
  ).resolves.toEqual(["SPAN", "DIV", "BUTTON"]);
  await expect(
    page
      .locator(".v5-alliance-score.blue")
      .evaluate((element) => [...element.children].map((child) => child.tagName)),
  ).resolves.toEqual(["BUTTON", "DIV", "SPAN"]);
  await expect(page.locator(".v5-alliance-score.blue .v5-alliance-name")).toHaveCSS(
    "font-size",
    await page
      .locator(".v5-alliance-score.red .v5-alliance-name")
      .evaluate((element) => getComputedStyle(element).fontSize),
  );
  await expect(page.locator(".v5-alliance-score.blue")).toHaveCSS("border-right-color", "rgb(114, 185, 238)");
  await expect(page.locator("#v5-autonomous-red")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#v5-autonomous-red")).toHaveCSS("border-radius", "50%");
  await expect(page.locator("#v5-autonomous-blue")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#v5-autonomous-blue")).toHaveCSS("border-radius", "2px");
  const field = page.locator(".v5-field");
  await expect(field.locator(".v5-quadrant")).toHaveCount(4);
  await expect(field.locator(".v5-quadrant").first().locator(".v5-count")).toHaveCount(3);
  await expect(field.locator(".field-marker-dot.red")).toHaveCount(2);
  await expect(field.locator(".field-marker-dot.blue")).toHaveCount(2);
  const marker = field.locator(".v5-field-center");
  const markerBox = await marker.boundingBox();
  const dots = await marker.locator(".field-marker-dot").all();
  for (const [index, dot] of dots.entries()) {
    const dotBox = await dot.boundingBox();
    expect(dotBox.x - markerBox.x).toBeCloseTo(index % 2 ? markerBox.width - dotBox.width - 2 : 2, 0);
    expect(dotBox.y - markerBox.y).toBeCloseTo(index < 2 ? 2 : markerBox.height - dotBox.height - 2, 0);
  }
  expect(await field.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
  const columns = await field.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" "));
  expect(columns).toHaveLength(3);
  expect(Number.parseFloat(columns[1])).toBe(8);
  const leftQuadrant = await field.locator(".v5-quadrant").nth(0).boundingBox();
  const rightQuadrant = await field.locator(".v5-quadrant").nth(1).boundingBox();
  expect(rightQuadrant.x - leftQuadrant.x - leftQuadrant.width).toBe(8);
  const fieldBox = await field.boundingBox();
  const midfieldBox = await page.locator(".v5-midfield").boundingBox();
  expect(midfieldBox.y - fieldBox.y - fieldBox.height).toBeGreaterThanOrEqual(8);
  const expectTimerInsideRing = async () => {
    const dialBox = await page.locator("#practice-timer-dial").boundingBox();
    const textBox = await page.locator("#practice-timer").boundingBox();
    const innerRadius = dialBox.width / 2 - 10;
    expect(Math.hypot(textBox.width / 2, textBox.height / 2)).toBeLessThan(innerRadius - 4);
  };
  await page.setViewportSize({ width: 1953, height: 1052 });
  await page.click("#practice-fullscreen");
  await expect(page.locator("#practice-ranking-note")).toBeHidden();
  await expectTimerInsideRing();
  await page.click("#practice-flow-exit");
  await expect(page.locator("#practice-ranking-note")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.click("#practice-fullscreen");
  await expectTimerInsideRing();
  await page.click("#practice-flow-exit");
  await page.setViewportSize({ width: 390, height: 844 });
  const firstQuadrant = page.locator(".v5-quadrant").first();
  await expect(firstQuadrant.locator(".v5-count>label")).toHaveCount(0);
  await expect(firstQuadrant.locator(".v5-count input")).toHaveCount(3);
  expect(
    await firstQuadrant
      .locator(".v5-count input")
      .evaluateAll((inputs) => inputs.every((input) => input.readOnly)),
  ).toBe(true);
  const boundedCounter = firstQuadrant.locator(".v5-count.red");
  const pinValue = boundedCounter.locator("input");
  const pinMinus = boundedCounter.locator('[data-step="-1"]');
  const pinPlus = boundedCounter.locator('[data-step="1"]');
  await expect(pinValue).toHaveCSS("border-top-width", "0px");
  await expect(pinValue).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(pinValue).toHaveCSS("font-weight", "700");
  await expect(pinMinus).toBeDisabled();
  await expect(pinPlus).toBeEnabled();
  for (let count = 0; count < 16; count++) await pinPlus.click();
  await expect(pinValue).toHaveValue("16");
  await expect(pinPlus).toBeDisabled();
  await pinMinus.click();
  await expect(pinValue).toHaveValue("15");
  await expect(pinPlus).toBeEnabled();
  for (let count = 0; count < 15; count++) await pinMinus.click();
  await expect(pinValue).toHaveValue("0");
  await expect(pinMinus).toBeDisabled();
  const counters = firstQuadrant.locator(".v5-count");
  for (let index = 0; index < (await counters.count()); index++) {
    const counter = counters.nth(index);
    const counterBox = await counter.boundingBox();
    const stepperBox = await counter.locator(".v5-stepper").boundingBox();
    expect(stepperBox.x + stepperBox.width / 2).toBeCloseTo(counterBox.x + counterBox.width / 2, 0);
  }
  await expect(firstQuadrant.locator(".toggle-icon").allTextContents()).resolves.toEqual(["", "X", ""]);
  await expect(
    firstQuadrant
      .locator("[data-toggle-value]")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
  ).resolves.toEqual(["Set Toggle to red", "Set Toggle to yellow", "Set Toggle to blue"]);
  await expect(firstQuadrant.locator(".v5-toggle [role=group]")).toHaveCSS(
    "grid-template-columns",
    "36px 36px 36px",
  );
  await expect(firstQuadrant.locator(".toggle-icon-neutral")).toHaveCSS("color", "rgb(197, 200, 200)");
  await expect(firstQuadrant).toHaveCSS("border-top-color", "rgb(121, 123, 124)");
  await page.selectOption("#practice-team", "1A");
  await page.selectOption("#practice-partner", "2A");
  await page.selectOption("#practice-blue-team", "3A");
  await page.selectOption("#practice-blue-partner", "4A");

  await page.click("#start-practice");
  await expect(page.locator("#practice-timer-label")).toHaveText("AUTONOMOUS PERIOD");
  await page.clock.fastForward(15000);
  await expect(page.locator("#practice-timer")).toHaveText("1:45");
  await expect(page.locator("#practice-timer-label")).toHaveText("DRIVER PERIOD READY");
  const cancelHandoff = page.locator("#reset-practice-timer");
  const driverPlay = page.locator("#start-practice");
  await expect(cancelHandoff).toBeVisible();
  await expect(cancelHandoff).toHaveAttribute("aria-label", "Cancel Teamwork run");
  await expect(cancelHandoff.locator(".run-cancel-icon")).toBeVisible();
  await expect(cancelHandoff).toHaveCSS("background-color", "rgb(189, 64, 72)");
  await expect(page.locator("#start-practice")).toHaveAttribute(
    "aria-label",
    "Start Driver Controlled Period",
  );
  expect((await cancelHandoff.boundingBox()).x).toBeLessThan((await driverPlay.boundingBox()).x);
  await page.click("#reset-practice-timer");
  await expect(page.locator("#practice-timer")).toHaveText("0:15");
  await page.click("#start-practice");
  await page.clock.fastForward(15000);
  await expect(page.locator("#practice-timer-label")).toHaveText("DRIVER PERIOD READY");
  await page.click("#start-practice");
  await expect(page.locator("#practice-timer-label")).toHaveText("DRIVER CONTROLLED PERIOD");
  await page.click("#stop-practice");
  await page.click("#reset-practice-timer");
  await expect(page.locator("#practice-timer")).toHaveText("0:15");

  const increase = async (path, count) => {
    const button = page.locator(`[data-step="1"][data-counter="practice-field-${path}"]`);
    for (let index = 0; index < count; index++) await button.click();
  };
  await increase("quadrants-0-red", 2);
  await increase("quadrants-0-yellow", 1);
  await page.click('[data-v5-toggle="quadrants.0.toggle"][data-toggle-value="red"]');
  await expect(firstQuadrant).toHaveClass(/toggle-red/);
  await increase("quadrants-1-blue", 3);
  await increase("quadrants-1-yellow", 2);
  await page.click('[data-v5-toggle="quadrants.1.toggle"][data-toggle-value="blue"]');
  await increase("midfield-red", 1);
  await increase("midfield-blue", 2);
  await increase("midfield-yellow", 1);
  await page.locator('[data-v5-robot="red"]').first().check();
  await page.locator('[data-v5-robot="blue"]').first().check();
  await page.locator('[data-v5-robot="blue"]').nth(1).check();
  const midfield = page.locator(".v5-midfield");
  await expect(midfield).toHaveClass(/highlight-blue/);
  await page.locator('[data-v5-robot="red"]').nth(1).check();
  await expect(midfield).toHaveClass(/highlight-neutral/);
  await page.locator('[data-v5-robot="blue"]').nth(1).uncheck();
  await expect(midfield).toHaveClass(/highlight-red/);
  await page.locator('[data-v5-robot="red"]').nth(1).uncheck();
  await page.locator('[data-v5-robot="blue"]').nth(1).check();
  await page.click('[data-autonomous-bonus="red"]');
  await expect(page.locator('[data-autonomous-bonus="red"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#v5-red-score")).toHaveText("45");
  await expect(page.locator("#v5-blue-score")).toHaveText("71");
  await page.click('[data-autonomous-bonus="blue"]');
  await expect(page.locator('[data-autonomous-bonus="blue"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#v5-red-score")).toHaveText("39");
  await expect(page.locator("#v5-blue-score")).toHaveText("77");
  await page.click('[data-autonomous-bonus="blue"]');
  await expect(page.locator('[data-autonomous-bonus="blue"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#v5-red-score")).toHaveText("45");
  await expect(page.locator("#v5-blue-score")).toHaveText("71");
  await page.click('[data-v5-toggle="quadrants.0.toggle"][data-toggle-value="blue"]');
  await expect(page.locator("#v5-red-score")).toHaveText("35");
  await expect(page.locator("#v5-blue-score")).toHaveText("81");
  await page.click('[data-v5-toggle="quadrants.0.toggle"][data-toggle-value="red"]');
  await expect(page.locator("#v5-red-score")).toHaveText("45");
  await expect(page.locator("#v5-blue-score")).toHaveText("71");
  await page.click("#save-practice");
  await expect(page.locator("#practice-runs")).toContainText("Red 1A + 2A / Blue 3A + 4A");
  await expect(page.locator("#practice-runs")).toContainText("Red 45 / Blue 71");

  await page.click('[data-tab="analysis"]');
  await expect(page.locator("#analysis-rows")).toBeHidden();
  await expect(page.locator("#v5-analysis-controls")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.querySelector("#team-profile").getBoundingClientRect().top -
        document.querySelector("#v5-analysis-team").getBoundingClientRect().bottom,
    ),
  ).toBeGreaterThanOrEqual(12);
  await page.selectOption("#v5-analysis-team", "1A");
  const metrics = page.locator("#v5-scrimmage-metrics tr td");
  await expect(metrics.nth(0)).toHaveText("1");
  await expect(metrics.nth(1)).toHaveText("0-0-1");
  await expect(metrics.nth(2)).toHaveText("0");
  await expect(metrics.nth(3)).toHaveText("1");
  await expect(metrics.nth(4)).toHaveText("71");
  await expect(metrics.nth(5)).toHaveText("45.00 / 45.00");
  await expect(metrics.nth(8)).toHaveText("--");
  await expect(page.locator("#v5-rating-note")).toBeVisible();
  await expect(page.locator("#team-analysis-trends")).toContainText("Teamwork scrimmage");
  await expect(page.locator("#official-standings")).toBeHidden();
  await page.selectOption("#v5-analysis-team", "4810Z");
  await expect(page.locator('#v5-analysis-team option[value="4810Z"]')).toHaveText("4810Z / Zigzag");
  await expect(page.locator("#team-analysis-heading")).toHaveText("Zigzag");
  await expect(page.locator("#team-analysis-team-id")).toHaveText("4810Z");
  expect(
    await page.evaluate(
      () =>
        document.querySelector("#team-analysis-team-id").getBoundingClientRect().left -
        document.querySelector("#team-analysis-heading").getBoundingClientRect().right,
    ),
  ).toBeGreaterThanOrEqual(12);
  await expect(page.locator(".team-analysis-header")).toHaveCSS("border-bottom-width", "0px");
  await expect(page.locator("#team-profile-row")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.querySelector("#team-profile").getBoundingClientRect().top -
        document.querySelector(".team-analysis-header").getBoundingClientRect().bottom,
    ),
  ).toBeLessThanOrEqual(8.5);
  await expect(page.locator("#official-standings")).toBeVisible();
  await expect(page.locator("#team-analysis-saved-heading")).toContainText("Saved run analysis");
  expect(
    await page.evaluate(() =>
      Boolean(
        document
          .querySelector("#official-standings")
          .compareDocumentPosition(document.querySelector("#team-analysis-saved-heading")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Boolean(
        document
          .querySelector("#official-standings")
          .compareDocumentPosition(
            document.querySelector("#team-analysis-summary").closest(".table-scroll"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  ).toBe(true);
  const official = page.locator("#official-standings-row tr td");
  await expect(official.nth(0)).toHaveText("2");
  await expect(official.nth(1)).toHaveText("405");
  await expect(official.nth(2)).toHaveText("37");
  await expect(official.nth(3)).toHaveText("9");
  await expect(official.nth(4)).toHaveText("28");
  await expect(official.nth(5)).toHaveText("9");
  await expect(official.nth(6)).toHaveText("28");
  await expect(page.locator("#official-standings-captured")).toHaveText("2026-11-11");
  await page.selectOption("#v5-analysis-team", "6008G");
  await expect(page.locator("#official-standings-grade")).toHaveText("High School");
  await expect(page.locator("#official-standings-row tr td").allTextContents()).resolves.toEqual([
    "12",
    "250",
    "106",
    "18",
    "88",
    "18",
    "88",
  ]);
  await expect(page.locator("#official-standings-source")).toHaveAttribute(
    "href",
    "https://events.vex.com/?search=6008G",
  );
  await expect(page.locator("#official-standings-status")).toContainText("Updated from VEX");
  expect(await page.evaluate(() => window.__standingsRefreshCount)).toBe(1);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tab="practice"]');
  await page.click('[data-tab="analysis"]');
  await expect.poll(() => page.evaluate(() => window.__standingsRefreshCount)).toBe(2);
  await page.click('[data-tab="practice"]');
  await page.evaluate(() => {
    window.__failStandingsRefresh = true;
  });
  await page.click('[data-tab="analysis"]');
  await expect(page.locator("#official-standings-status")).toContainText("Live refresh failed");
  await expect(page.locator("#official-standings-row tr td").nth(1)).toHaveText("250");
  await page.click('[data-tab="practice"]');

  await page.selectOption("#practice-mode", "driver");
  await expect(page.locator("#practice-timer")).toHaveText("1:00");
  await expect(page.locator("#practice-blue-alliance-fields")).toBeHidden();
  const skillsQuadrants = page.locator(".v5-quadrant");
  await expect(skillsQuadrants.nth(0).locator(".v5-count")).toHaveCount(2);
  await expect(skillsQuadrants.nth(0).locator(".v5-count.blue")).toHaveCount(0);
  await expect(skillsQuadrants.nth(1).locator(".v5-count")).toHaveCount(2);
  await expect(skillsQuadrants.nth(1).locator(".v5-count.red")).toHaveCount(0);
  const skillsMidfield = page.locator(".v5-midfield-layout.solo");
  await expect(skillsMidfield.locator(":scope > .v5-midfield-alliance")).toHaveCount(1);
  await expect(skillsMidfield.locator(":scope > .v5-midfield-pins")).toHaveCount(1);
  await expect(skillsMidfield.locator(".v5-robot-check span")).toHaveText("Robot");
  const controlCenter = async (locator) => {
    const box = await locator.boundingBox();
    return box.x + box.width / 2;
  };
  const redQuadrantPin = skillsQuadrants.nth(0).locator(".v5-count.red .v5-stepper");
  const blueQuadrantPin = skillsQuadrants.nth(1).locator(".v5-count.blue .v5-stepper");
  const skillsRobot = skillsMidfield.locator(".v5-midfield-alliance");
  const skillsPin = skillsMidfield.locator(".v5-midfield-pins .v5-stepper").first();
  expect(Math.abs((await controlCenter(skillsRobot)) - (await controlCenter(redQuadrantPin)))).toBeLessThan(
    12,
  );
  expect(Math.abs((await controlCenter(skillsPin)) - (await controlCenter(blueQuadrantPin)))).toBeLessThan(
    12,
  );
  await expect(page.locator("#practice-score-total")).toHaveText("88");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  }
  await page.click('[data-tab="rubric"]');
  await expect(page.locator("#rubric-view")).toBeVisible();
  await page.click('[data-tab="interview"]');
  await expect(page.locator("#interview-view")).toBeVisible();
  expect(errors).toEqual([]);
});

test("V5 listed students get the same Access management controls as coaches", async ({ page }) => {
  const project = path.resolve(__dirname, "..");
  execFileSync(process.execPath, ["build-apps-script.js", "override"], { cwd: project });
  await page.addInitScript(() => {
    let entries = [];
    let storage;
    Object.defineProperty(window, "EventStorage", {
      configurable: true,
      get: () => storage,
      set: (value) => {
        storage = value;
        value.shared = true;
        value.access = {
          canEdit: true,
          role: "coach",
          team: "",
          email: "coach@nu-district.org",
          domain: "nu-district.org",
          isOwner: true,
        };
        value.loadAccess = async () => ({
          owner: "coach@nu-district.org",
          domain: "nu-district.org",
          entries,
        });
        value.saveAccess = async (next) => {
          entries = next;
          return { owner: "coach@nu-district.org", domain: "nu-district.org", entries };
        };
      },
    });
  });
  await page.goto("/apps-script/dist-v5/Index.html");
  await expect(page.locator("#save-state")).toHaveText("");
  expect(
    await page.evaluate(() => ({
      game: VexGame.active.id,
      practiceOnly: VexGame.active.practiceOnly,
      shared: EventStorage.shared,
      role: EventStorage.access.role,
    })),
  ).toEqual({ game: "override", practiceOnly: true, shared: true, role: "coach" });
  await expect(page.locator("#associated-team")).toBeHidden();
  await page.click('[data-tab="setup"]');
  await page.fill("#team-id", "4810Z");
  await page.fill("#team-name", "Zigzag");
  await page.click("#save-team");
  await page.evaluate(() => {
    EventStorage.access = { ...EventStorage.access, team: "4810Z" };
    renderFooter();
  });
  await expect(page.locator("#associated-team")).toHaveText("Your team: 4810Z / Zigzag");
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    EventStorage.access = { ...EventStorage.access, team: "" };
    renderFooter();
  });
  await expect(page.locator("#associated-team")).toBeHidden();
  await page.click("#open-settings");
  await expect(page.locator("#settings-access")).toBeVisible();
  await page.click("#open-access");
  await expect(page.locator("#access-view")).toBeVisible();
  await expect(page.locator("#access-name")).toBeVisible();
  await expect(page.locator("#access-role").locator("xpath=..")).toBeHidden();
  await expect(page.locator("#access-team").locator("xpath=..")).toBeVisible();
  await expect(page.locator("#access-team").locator("option").first()).toHaveText("No default team");
  await page.fill("#access-name", "Student Editor");
  await page.fill("#access-email", "student@nu-district.org");
  await page.selectOption("#access-team", "4810Z");
  await page.click("#save-access");
  await expect(page.locator("#access-rows")).toContainText("student@nu-district.org");
  await expect(page.locator("#access-rows")).toContainText("4810Z / Zigzag");
  await expect(page.locator("#access-rows")).toContainText("Editor");
  await expect(page.locator("#access-permissions-note")).toContainText("same editing permissions");
  await page.click('[data-access-edit="student@nu-district.org"]');
  await expect(page.locator("#access-name")).toHaveValue("Student Editor");
  await expect(page.locator("#access-team")).toHaveValue("4810Z");
  await page.fill("#access-name", "Student Editor Updated");
  await page.click("#save-access");
  await expect(page.locator("#access-rows")).toContainText("Student Editor Updated");
  await expect(page.locator("#access-rows tr")).toHaveCount(2);
});
