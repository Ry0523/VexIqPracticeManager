"use strict";
const { test, expect } = require("@playwright/test");
const { openApp, addTeams, schedule, useFakeTimerClock } = require("./helpers.js");

const teams = [
  ["1A", "One"],
  ["2A", "Two"],
  ["3A", "Three"],
  ["4A", "Four"],
];

test.beforeEach(async ({ page }) => {
  await useFakeTimerClock(page);
});

test("screen wake lock follows fullscreen, timers, and page visibility", async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: undefined });
    window.__wake = {
      requests: 0,
      releases: 0,
      active: 0,
      setHidden(value) {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async (type) => {
          if (type !== "screen") throw new Error("Unexpected wake lock type");
          window.__wake.requests++;
          window.__wake.active++;
          const lock = new EventTarget();
          lock.release = async () => {
            window.__wake.releases++;
            window.__wake.active--;
            lock.dispatchEvent(new Event("release"));
          };
          return lock;
        },
      },
    });
  });
  const errors = await openApp(page);
  await schedule(page, teams, 1);
  await page.click("#fullscreen");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(1);
  await page.evaluate(() => window.__wake.setHidden(true));
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(0);
  await page.evaluate(() => window.__wake.setHidden(false));
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(1);
  await page.click("#start-timer");
  await page.click("#flow-exit");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(1);
  await page.clock.fastForward(2500);
  await page.click("#start-timer");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(0);

  await page.click('[data-tab="practice"]');
  await page.click("#practice-fullscreen");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(1);
  await page.click("#practice-flow-exit");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(0);
  await page.click("#start-practice");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(1);
  await page.clock.fastForward(2500);
  await page.click("#stop-practice");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(0);

  await page.click('[data-tab="skills"]');
  await page.click("#skills-fullscreen");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(1);
  await page.click("#skills-flow-exit");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(0);
  await page.click("#start-skills");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(1);
  await page.clock.fastForward(2500);
  await page.click("#stop-skills");
  await expect.poll(() => page.evaluate(() => window.__wake.active)).toBe(0);
  expect(errors).toEqual([]);
});

test("wake lock denial and delayed acquisition do not disrupt timers", async ({ page }) => {
  await page.addInitScript(() => {
    window.__wake = { requests: 0, releases: 0, resolve: null };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: () => {
          window.__wake.requests++;
          if (window.__wake.requests === 1) return Promise.reject(new Error("Wake lock denied"));
          return new Promise((resolve) => {
            window.__wake.resolve = () =>
              resolve({
                release: async () => {
                  window.__wake.releases++;
                },
                addEventListener() {},
              });
          });
        },
      },
    });
  });
  const errors = await openApp(page);
  await schedule(page, teams, 1);
  await page.click("#start-timer");
  await expect(page.locator("#timer-label")).toHaveText("STARTING IN 3");
  await expect.poll(() => page.evaluate(() => window.__wake.requests)).toBe(1);
  await page.clock.fastForward(2500);
  await expect(page.locator("#timer-label")).toHaveText("MATCH IN PROGRESS");
  await page.click("#start-timer");
  await page.click("#start-timer");
  await expect.poll(() => page.evaluate(() => window.__wake.requests)).toBe(2);
  await page.click("#start-timer");
  await page.evaluate(() => window.__wake.resolve());
  await expect.poll(() => page.evaluate(() => window.__wake.releases)).toBe(1);
  expect(errors).toEqual([]);
});

test("match timer counts down through the start countdown, driver switch window, pause, and end", async ({
  page,
}) => {
  const errors = await openApp(page);
  await schedule(page, teams, 1);
  expect(
    Number(
      await page
        .locator("#timer-dial")
        .evaluate((element) =>
          parseFloat(getComputedStyle(element).getPropertyValue("--timer-progress-angle")),
        ),
    ),
  ).toBe(0);
  // Reset is only available once a stopped timer has moved off the full minute.
  await expect(page.locator("#reset-timer")).toBeDisabled();
  await page.click("#start-timer");
  await expect(page.locator("#timer-label")).toHaveText("STARTING IN 3");
  await expect(page.locator("#start-timer")).toHaveText("Pause match");
  await expect(page.locator("#reset-timer")).toBeDisabled();
  // Countdown beats are 0.75 s apart; the run starts after 2.384 s.
  await page.clock.fastForward(800);
  await expect(page.locator("#timer-label")).toHaveText("STARTING IN 2");
  await page.clock.fastForward(750);
  await expect(page.locator("#timer-label")).toHaveText("STARTING IN 1");
  await page.clock.fastForward(700);
  await expect(page.locator("#timer-label")).toHaveText("STARTING IN 1");
  await page.clock.fastForward(200);
  await expect(page.locator("#timer-label")).toHaveText("MATCH IN PROGRESS");
  await expect(page.locator("#timer")).toHaveText(/^0:\d{2}$/);
  await expect(page.locator("#reset-timer")).toBeDisabled();
  const runStartAngle = Number(
    await page
      .locator("#timer-dial")
      .evaluate((element) =>
        parseFloat(getComputedStyle(element).getPropertyValue("--timer-progress-angle")),
      ),
  );

  // Resetting a paused run needs no confirmation.
  await page.clock.fastForward(1000);
  const activeAngle = Number(
    await page
      .locator("#timer-dial")
      .evaluate((element) =>
        parseFloat(getComputedStyle(element).getPropertyValue("--timer-progress-angle")),
      ),
  );
  expect(activeAngle).toBeGreaterThan(runStartAngle);
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
  expect(
    Number(
      await page
        .locator("#timer-dial")
        .evaluate((element) =>
          parseFloat(getComputedStyle(element).getPropertyValue("--timer-progress-angle")),
        ),
    ),
  ).toBe(360);
  await expect(page.locator("#start-timer")).toBeDisabled();

  await page.click("#reset-timer");
  await expect(page.locator("#timer-label")).toHaveText("READY FOR MATCH");
  await expect(page.locator("#reset-timer")).toBeDisabled();
  expect(await page.evaluate(() => window.__confirms)).toEqual([]);
  expect(errors).toEqual([]);
});

test("Teamwork and Skills leaderboards have no CSV export buttons", async ({ page }) => {
  await openApp(page);
  await page.click('[data-tab="rankings"]');
  await expect(page.locator("#export-csv")).toHaveCount(0);
  await page.click('[data-tab="skills-rankings"]');
  await expect(page.locator("#export-skills")).toHaveCount(0);
});

test("3-second countdown can be disabled and the setting persists on this device", async ({ page }) => {
  await openApp(page);
  await page.click("#open-settings");
  await expect(page.locator("#timer-countdown")).toBeChecked();
  await page.uncheck("#timer-countdown");
  await page.click("#close-settings");
  await page.reload();
  await expect(page.locator("#save-state")).toHaveText("");
  await page.click("#open-settings");
  await expect(page.locator("#timer-countdown")).not.toBeChecked();
  await page.click("#close-settings");

  await schedule(page, teams, 1);
  await page.click("#start-timer");
  await expect(page.locator("#timer-label")).toHaveText("MATCH IN PROGRESS");
});

test("sound icon toggles across timer rings and persists on this device", async ({ page }) => {
  await openApp(page);
  await schedule(page, teams, 1);
  const matchSound = page.locator("#timer-dial .timer-sound-toggle");
  await expect(matchSound).toHaveAttribute("aria-pressed", "true");
  await expect(matchSound.locator(".sound-icon-on")).toBeVisible();
  await matchSound.click();
  await expect(matchSound).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(() => ({
      enabled: document.querySelector("#sound").checked,
      pressed: document.querySelector("#timer-dial .timer-sound-toggle").getAttribute("aria-pressed"),
      onHidden: document.querySelector("#timer-dial .sound-icon-on").hasAttribute("hidden"),
      offHidden: document.querySelector("#timer-dial .sound-icon-off").hasAttribute("hidden"),
    })),
  ).toEqual({ enabled: false, pressed: "false", onHidden: true, offHidden: false });
  await expect(matchSound.locator(".sound-icon-off")).toBeVisible();
  await expect(page.locator("#sound")).not.toBeChecked();

  await page.click('[data-tab="skills"]');
  await expect(page.locator("#skills-timer-dial .timer-sound-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.click('[data-tab="practice"]');
  await expect(page.locator("#practice-timer-dial .timer-sound-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.click("#open-settings");
  await expect(page.locator("#sound")).toBeHidden();
  await expect(page.locator("#timer-countdown")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.locator("#save-state")).toHaveText("");
  await page.click('[data-tab="control"]');
  await expect(page.locator("#timer-dial .timer-sound-toggle")).toHaveAttribute("aria-pressed", "false");
});

test("full-screen flow runs, scores, and posts each match, then exits after the last one", async ({
  page,
}) => {
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
  expect(await page.evaluate(() => state.matches.map((match) => Boolean(match.result)))).toEqual([
    true,
    true,
  ]);
  expect(await page.evaluate(() => History.resolve(state.history).length)).toBe(2);
});

test("practice draft state follows current values and clears after canceling a timer start", async ({
  page,
}) => {
  await openApp(page);
  await addTeams(page, [
    ["1A", "One"],
    ["2A", "Two"],
  ]);
  await page.click('[data-tab="practice"]');
  expect(await page.evaluate(() => PracticeUI.isDirty())).toBe(false);

  await page.fill("#practice-notes", "Temporary note");
  expect(await page.evaluate(() => PracticeUI.isDirty())).toBe(true);
  await page.fill("#practice-notes", "");
  expect(await page.evaluate(() => PracticeUI.isDirty())).toBe(false);

  await page.click("#start-practice");
  await page.waitForFunction(() => PracticeUI.isRunning());
  expect(await page.evaluate(() => PracticeUI.isDirty())).toBe(true);
  await page.click("#stop-practice");
  await page.waitForFunction(() => !PracticeUI.isRunning() && !PracticeUI.isDirty());
});

test("practice timer controls pause, resume, stop with sound, and reset", async ({ page }) => {
  await openApp(page);
  await addTeams(page, [
    ["1A", "One"],
    ["2A", "Two"],
  ]);
  await page.click('[data-tab="practice"]');

  await page.click("#start-practice");
  await page.waitForFunction(() => PracticeUI.isRunning());
  await page.clock.fastForward(2384);
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE IN PROGRESS");
  await expect(page.locator("#pause-practice")).toBeVisible();
  await expect(page.locator("#stop-practice")).toBeVisible();

  await page.click("#pause-practice");
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE RUN PAUSED");
  const pausedTime = await page.locator("#practice-timer").textContent();
  await expect(page.locator("#reset-practice-timer")).toBeVisible();
  await expect(page.locator("#start-practice")).toBeVisible();
  await page.clock.fastForward(5000);
  await expect(page.locator("#practice-timer")).toHaveText(pausedTime);

  await page.click("#start-practice");
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE IN PROGRESS");
  await page.click("#stop-practice");
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE RUN ENDED");
  await expect(page.locator("#reset-practice-timer")).toBeVisible();
  await expect(page.locator("#start-practice")).toBeHidden();
  await page.click("#reset-practice-timer");
  await expect(page.locator("#practice-timer-label")).toHaveText("READY FOR PRACTICE");
  await expect(page.locator("#reset-practice-timer")).toBeHidden();
  await expect(page.locator("#start-practice")).toBeVisible();
});

test("full-screen practice shows the timer and scoring on one page and posts each run before the next", async ({
  page,
}) => {
  const errors = await openApp(page);
  await addTeams(page, [
    ["1A", "One"],
    ["2A", "Two"],
  ]);
  await page.click('[data-tab="practice"]');
  const form = page.locator("#practice-form");
  await page.click("#practice-fullscreen");
  await expect(form).toHaveClass(/flow-mode/);
  await expect(page.locator("#practice-flow-label")).toHaveText(
    "Practice run \u00b7 Driver skills \u00b7 1A",
  );
  await expect(page.locator("#practice-timer")).toBeInViewport();
  await expect(page.locator("#practice-scoring-inputs")).toBeVisible();
  await expect(page.locator("#practice-flow-next")).toHaveText("Next run \u2192");
  await expect(page.locator("#new-practice-bottom")).toBeHidden();

  await page.click("#start-practice");
  await page.clock.fastForward(2384 + 60000);
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE RUN ENDED");
  await page.locator('#practice-scoring-inputs [data-step="1"]').first().click();
  await expect(page.locator("#practice-flow-next")).toHaveText("Post & next run \u2192");
  await expect(page.locator("#new-practice-bottom")).toHaveText("Discard & next run");
  await page.click("#practice-flow-next");
  await expect(page.locator("#practice-timer-label")).toHaveText("READY FOR PRACTICE");
  await expect(page.locator("#practice-score-total")).toHaveText("0");
  await expect(form).toHaveClass(/flow-mode/);
  expect(
    await page.evaluate(
      () => History.resolve(state.history).filter((record) => record.source === "practice").length,
    ),
  ).toBe(1);
  await expect(page.locator("#practice-date")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Number.isFinite(
        Date.parse(History.resolve(state.history).find((record) => record.source === "practice").occurredAt),
      ),
    ),
  ).toBe(true);

  await expect(page.locator("#start-practice")).toBeEnabled();
  await page.click("#start-practice");
  await page.clock.fastForward(2384 + 5000);
  await expect(page.locator("#practice-timer")).toHaveText(/^0:\d{2}$/);
  await page.clock.fastForward(55000);
  await expect(page.locator("#practice-timer-label")).toHaveText("PRACTICE RUN ENDED");
  await page.click("#practice-flow-next");
  await expect(page.locator("#practice-timer-label")).toHaveText("READY FOR PRACTICE");

  await page.click("#practice-flow-exit");
  await expect(form).not.toHaveClass(/flow-mode/);
  await expect(page.locator("#new-practice-bottom")).toHaveText("Next run");
  await expect(page.locator("#practice-runs tr")).toHaveCount(2);
  await expect(page.locator("#practice-runs")).toContainText("Coach run");
  await expect(page.locator("#practice-ranking-note")).toBeEmpty();
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
  expect(await page.evaluate(() => state.matches.some((match) => match.result))).toBe(false);
});

async function openSkills(page) {
  await addTeams(page, teams.slice(0, 2));
  await page.click('[data-tab="skills"]');
  await page.check("#skills-only");
  await expect(page.locator("#skills-eligibility")).toHaveText("Skills-only event");
}

test("Skills timer opens full screen with scoring and exits cleanly", async ({ page }) => {
  await openApp(page);
  await openSkills(page);
  const normalLayout = await page.evaluate(() => ({
    stopTop: document.querySelector("#skills-stop-time").closest("label").getBoundingClientRect().top,
    attemptsBottom: document.querySelector("#skills-attempt-log").getBoundingClientRect().bottom,
    timerBottom: document.querySelector("#skills-timer-stage").getBoundingClientRect().bottom,
    scoreTop: document.querySelector("#skills-score-total").getBoundingClientRect().top,
  }));
  expect(normalLayout.stopTop).toBeGreaterThan(normalLayout.attemptsBottom);
  expect(normalLayout.scoreTop).toBeGreaterThan(normalLayout.timerBottom);

  await page.click("#skills-fullscreen");
  await expect(page.locator("#skills-view")).toHaveClass(/skills-flow-mode/);
  await expect(page.locator("#skills-flow-bar")).toBeVisible();
  await expect(page.locator("#skills-flow-label")).toContainText("1A / One");
  await expect(page.locator("#skills-flow-label")).toContainText("Driver / Attempt 1 of 3");
  await expect(page.locator("#skills-timer-stage")).toBeVisible();
  await expect(page.locator("#skills-form")).toBeVisible();
  await expect(page.locator(".skills-settings")).toBeHidden();
  await expect(page.locator(".skills-live-standings")).toBeHidden();
  const fullscreenLayout = await page.evaluate(() => ({
    modes: Array.from(document.querySelectorAll("#skills-attempt-log .skills-log-mode"), (element) =>
      element.getBoundingClientRect(),
    ),
    stop: document.querySelector("#skills-stop-time").closest("label").getBoundingClientRect(),
    timerLeft: document.querySelector("#skills-timer-stage").getBoundingClientRect().left,
    timerTop: document.querySelector("#skills-timer-stage").getBoundingClientRect().top,
    scoreLeft: document.querySelector("#skills-score-total").getBoundingClientRect().left,
  }));
  expect(fullscreenLayout.modes[1].top).toBeGreaterThan(fullscreenLayout.modes[0].bottom);
  expect(fullscreenLayout.stop.top).toBeGreaterThan(fullscreenLayout.modes[1].bottom);
  expect(fullscreenLayout.timerTop).toBeGreaterThanOrEqual(fullscreenLayout.stop.bottom);
  expect(fullscreenLayout.timerLeft).toBeLessThan(fullscreenLayout.scoreLeft);

  await page.click("#skills-flow-exit");
  await expect(page.locator("#skills-view")).not.toHaveClass(/skills-flow-mode/);
  await page.click("#skills-fullscreen");
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await page.keyboard.press("Escape");
  await expect(page.locator("#skills-view")).not.toHaveClass(/skills-flow-mode/);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    timerBottom: document.querySelector("#skills-timer-stage").getBoundingClientRect().bottom,
    scoreTop: document.querySelector("#skills-score-total").getBoundingClientRect().top,
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(390);
  expect(mobileLayout.scoreTop).toBeGreaterThan(mobileLayout.timerBottom);
});

test("ending a driver skills run early records the stop time with the posted attempt", async ({ page }) => {
  const errors = await openApp(page);
  await openSkills(page);
  await page.check("#skills-opt-in");
  await page.click("#start-skills");
  await expect(page.locator("#skills-timer-label")).toHaveText("STARTING IN 3");
  await expect(page.locator("#stop-skills")).toBeVisible();
  await expect(page.locator("#pause-skills")).toBeHidden();
  await expect(page.locator("#skills-opt-in")).toBeDisabled();
  await expect(page.locator("#save-skills")).toBeDisabled();

  await page.clock.fastForward(2384 + 26000);
  await expect(page.locator("#skills-timer-label")).toHaveText("DRIVER SWITCH WINDOW");
  await expect(page.locator("#pause-skills")).toBeVisible();
  await page.click("#pause-skills");
  await expect(page.locator("#skills-timer-label")).toHaveText("SKILLS RUN PAUSED");
  const pausedTime = await page.locator("#skills-timer").textContent();
  await page.clock.fastForward(5000);
  await expect(page.locator("#skills-timer")).toHaveText(pausedTime);
  await page.click("#start-skills");
  await expect(page.locator("#skills-timer-label")).toHaveText("DRIVER SWITCH WINDOW");
  await page.clock.fastForward(5000);
  await page.click("#stop-skills");
  await expect(page.locator("#skills-timer-label")).toHaveText("SKILLS RUN ENDED");
  await expect(page.locator("#skills-stop-time")).toHaveValue("29");

  await page.locator('#skills-scoring-inputs [data-step="1"]').first().click();
  await expect(page.locator("#save-skills")).toBeEnabled();
  await page.click("#save-skills");
  await expect(
    page.locator('[data-open-skills-mode="driver"][data-open-skills-attempt="1"]'),
  ).not.toContainText("--");
  expect(
    await page.evaluate(() =>
      state.skills.map(({ team, mode, attempt, stopTime }) => ({ team, mode, attempt, stopTime })),
    ),
  ).toEqual([{ team: "1A", mode: "driver", attempt: 1, stopTime: 29 }]);
  expect(
    await page.evaluate(
      () => History.resolve(state.history).filter((record) => record.kind === "skills").length,
    ),
  ).toBe(1);
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
  await expect(page.locator("#start-skills")).toBeHidden();
  await expect(page.locator("#reset-skills-timer")).toBeEnabled();
  await page.click("#reset-skills-timer");
  await expect(page.locator("#skills-timer-label")).toHaveText("READY FOR SKILLS");
  await expect(page.locator("#reset-skills-timer")).toBeHidden();
  await expect(page.locator("#start-skills")).toBeVisible();
});
