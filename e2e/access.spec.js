"use strict";
const { test, expect } = require("@playwright/test");
const { openApp, addTeams, schedule, autoConfirm } = require("./helpers.js");

// Builds a real event locally, then serves it through a fake Apps Script backend that reports the given access.
// Saves are accepted (and counted) unless the visitor is a viewer; the access list lives in memory.
async function sharedPage(browser, page, access, prepare = async () => {}) {
  await openApp(page);
  await schedule(page, [["1A", "One"], ["2A", "Two"], ["3A", "Three"], ["4A", "Four"]], 1);
  await page.locator('#scoring-inputs [data-step="1"]').first().click();
  await page.click("#save-score");
  await expect(page.locator("#match-status")).toHaveText("Posted");
  await prepare(page);
  const event = await page.evaluate(() => JSON.stringify(state));

  const context = await browser.newContext();
  const viewer = await context.newPage();
  await autoConfirm(viewer);
  await viewer.addInitScript(({ eventJson, access }) => {
    window.__saves = 0;
    window.__failSaves = 0;
    window.__accessLoads = 0;
    window.__access = [];
    let revision = Number(localStorage.getItem("__sharedRevision") || 3);
    let current = localStorage.getItem("__sharedEvent") || eventJson;
    const saveCurrent = event => { current = JSON.stringify(event); localStorage.setItem("__sharedEvent", current); };
    const nextRevision = () => { revision++; localStorage.setItem("__sharedRevision", String(revision)); return revision; };
    // Simulates another operator saving a newer event.
    window.__current = () => current;
    window.__publish = change => { const event = JSON.parse(current); change(event); saveCurrent(event); nextRevision(); };
    const owner = "owner@nu-district.org";
    const list = () => JSON.stringify({ ok: true, owner, domain: "nu-district.org", entries: window.__access });
    const attempt = save => { window.__saves++; if (window.__failSaves > 0) { window.__failSaves--; throw new Error("NetworkError: Connection failure due to HTTP 0"); } if (!access.canEdit) return JSON.stringify({ ok: false, code: "REFUSED", message: "Read-only access" }); return JSON.stringify(save()); };
    const api = {
      loadEventJson: () => JSON.stringify({ ok: true, revision, event: JSON.parse(current), access }),
      previewMemberJson: team => {
        if (access.isOwner !== true) throw new Error("App owner access required to preview the student view.");
        const event = JSON.parse(current);
        if (!event.teams.some(entry => entry.id === team)) throw new Error("Choose a team on the active roster to preview.");
        const redact = entry => entry.team.id === team ? entry : { ...entry, reviewer: "", overallNotes: "", notes: Object.fromEntries(Object.keys(entry.notes).map(id => [id, ""])) };
        const previewEvent = { ...event, rubrics: event.rubrics.map(redact), interviews: event.interviews.map(redact) };
        return JSON.stringify({ ok: true, revision, event: previewEvent, access: { canEdit: true, role: "member", team, email: "student-preview@nu-district.org", domain: "nu-district.org" }, previewing: true });
      },
      eventRevisionJson: () => JSON.stringify({ ok: true, revision }),
      saveEventJson: json => attempt(() => { const request = JSON.parse(json); if (request.revision !== revision) return { ok: false, code: "CONFLICT", message: "Another operator saved a newer event." }; saveCurrent(request.event); return { ok: true, revision: nextRevision() }; }),
      // Merges the page's changes into the latest event, as the real server does.
      saveChangesJson: json => attempt(() => { const merged = EventChanges.apply(JSON.parse(current), JSON.parse(json).changes); if (merged.conflicts.length) return { ok: false, code: "CONFLICT", message: `Another operator changed ${merged.conflicts.join(", ")} at the same time.` }; saveCurrent(merged.event); return { ok: true, previous: revision, revision: nextRevision() }; }),
      loadAccessJson: () => { window.__accessLoads++; if (access.role !== "coach") throw new Error("Only coaches can view the access list."); return list(); },
      saveAccessJson: json => { if (access.role !== "coach") throw new Error("Only coaches can change the access list."); window.__access = JSON.parse(json).entries; return list(); }
    };
    const run = {
      withSuccessHandler: success => ({
        withFailureHandler: failure => new Proxy({}, { get: (_, method) => argument => setTimeout(() => { try { success(api[method](argument)); } catch (error) { failure(error); } }) })
      })
    };
    window.google = { script: { run } };
  }, { eventJson: event, access });
  return viewer;
}

const sharedViewerPage = (browser, page) => sharedPage(browser, page, { canEdit: false, email: "parent@gmail.com", domain: "nu-district.org" });

test("coach Settings can preview a team member view without saving preview edits", async ({ browser, page }) => {
  const coach = await sharedPage(browser, page, { canEdit: true, role: "coach", email: "owner@nu-district.org", domain: "nu-district.org", isOwner: true });
  await coach.goto("/index.html");
  await expect(coach.locator("body")).not.toHaveClass(/member/);
  const originalName = await coach.evaluate(() => JSON.parse(window.__current()).name);
  await coach.click("#open-settings");
  await expect(coach.locator("#settings-student-preview")).toBeVisible();
  await coach.selectOption("#preview-student-team", "3A");
  await coach.click("#preview-student-view");
  await expect(coach.locator("body")).toHaveClass(/member/);
  await expect(coach.locator("#student-preview-banner")).toContainText("Team 3A");
  await expect(coach.locator('[data-tab="setup"]')).toBeHidden();
  await expect(coach.locator('[data-tab="practice"]')).toBeVisible();
  await expect(coach.locator("#practice-team")).toHaveValue("3A");
  expect(await coach.evaluate(() => EventStorage.access)).toMatchObject({ role: "member", team: "3A" });

  expect(await coach.evaluate(async () => { state.name = "Preview-only edit"; return persist(); })).toBe(true);
  expect(await coach.evaluate(() => JSON.parse(window.__current()).name)).toBe(originalName);
  expect(await coach.evaluate(() => window.__saves)).toBe(0);

  await coach.evaluate(() => { window.__confirmAnswer = null; });
  await coach.click("#exit-student-preview");
  await expect(coach.locator("#confirm-message")).toContainText("Practice runs and reviews created in the preview will be discarded");
  await coach.click("#confirm-ok");
  await expect(coach.locator("body")).not.toHaveClass(/member/);
  await expect(coach.locator("#student-preview-banner")).toBeHidden();
  expect(await coach.evaluate(() => state.name)).toBe(originalName);
  expect(await coach.evaluate(() => window.__saves)).toBe(0);
  await coach.context().close();
});

test("listed non-owner coaches cannot preview the student view", async ({ browser, page }) => {
  const coach = await sharedPage(browser, page, { canEdit: true, role: "coach", email: "coach@nu-district.org", domain: "nu-district.org", isOwner: false });
  await coach.goto("/index.html");
  await coach.click("#open-settings");
  await expect(coach.locator("#settings-access")).toBeVisible();
  await expect(coach.locator("#settings-student-preview")).toBeHidden();
  expect(await coach.evaluate(async () => {
    try { await EventStorage.previewMember("3A"); return false; }
    catch (error) { return error.message === "App owner access required to preview the student view."; }
  })).toBe(true);
  await coach.context().close();
});

test("a generated shared schedule survives a page reload", async ({ browser, page }) => {
  const coach = await sharedPage(browser, page, { canEdit: true, role: "coach", email: "coach@nu-district.org", domain: "nu-district.org" }, async localPage => {
    await localPage.evaluate(() => {
      state.matches = [];
      state.finals = [];
      state.finalsWithdrawn = [];
      state.skills = [];
      state.history = [];
      state.selected = null;
      state.selectedPhase = "qualification";
    });
  });
  await coach.goto("/index.html");
  await expect(coach.locator("body")).not.toHaveClass(/read-only/);
  await coach.fill("#rounds", "2");
  await coach.click("#generate");
  await expect.poll(() => coach.evaluate(() => JSON.parse(window.__current()).matches.length)).toBe(4);

  await coach.reload();
  await expect(coach.locator("#match-list button")).toHaveCount(4);
  expect(await coach.evaluate(() => state.matches.length)).toBe(4);
  await coach.context().close();
});

test("shared pages pick up scores saved elsewhere, but never discard work in progress", async ({ browser, page }) => {
  const coach = await sharedPage(browser, page, { canEdit: true, role: "coach", email: "coach@nu-district.org", domain: "nu-district.org" });
  await coach.goto("/index.html");
  await expect(coach.locator("body")).not.toHaveClass(/read-only/);
  await coach.click('[data-tab="rubric"]');
  await coach.selectOption("#rubric-team", "3A");
  await expect(coach.locator("#reload-shared")).toHaveJSProperty("hidden", true);
  const check = () => coach.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  // Idle: the page refreshes itself and keeps the selected review team.
  await coach.evaluate(() => window.__publish(event => { event.teams[0].name = "Renamed elsewhere"; }));
  await check();
  await expect.poll(() => coach.evaluate(() => state.teams[0].name)).toBe("Renamed elsewhere");
  await expect(coach.locator("#save-state")).toContainText("Updated");
  await expect(coach.locator("#rubric-team")).toHaveValue("3A");
  await expect(coach.locator("#notice")).toBeHidden();

  // Editing: a notice offers the reload instead, and the unposted score is kept.
  await coach.click('[data-tab="control"]');
  await coach.locator("#match-list button").nth(1).click();
  await coach.locator('#scoring-inputs [data-step="1"]').first().click();
  await coach.evaluate(() => window.__publish(event => { event.teams[0].name = "Renamed again"; }));
  await check();
  await expect(coach.locator("#notice-message")).toContainText("Newer shared scores are available");
  await expect(coach.locator("#reload-shared")).toHaveJSProperty("hidden", false);
  expect(await coach.evaluate(() => state.teams[0].name)).toBe("Renamed elsewhere");
  await coach.locator("#match-list button").nth(0).click();
  await check();
  await expect.poll(() => coach.evaluate(() => state.teams[0].name)).toBe("Renamed again");
  await expect(coach.locator("#notice")).toBeHidden();
  await expect(coach.locator("#reload-shared")).toHaveJSProperty("hidden", true);
  await coach.context().close();
});

test("a shared save that cannot reach the server retries on its own and reports when it is saved", async ({ browser, page }) => {
  const coach = await sharedPage(browser, page, { canEdit: true, role: "coach", email: "coach@nu-district.org", domain: "nu-district.org" });
  const errors = [];
  coach.on("pageerror", error => errors.push(error.message));
  await coach.goto("/index.html");
  await expect(coach.locator("body")).not.toHaveClass(/read-only/);
  await coach.evaluate(() => { EventStorage.retryDelays = [400]; window.__failSaves = 2; });
  await coach.click('[data-tab="control"]');
  await coach.locator("#match-list button").nth(1).click();
  await coach.locator('#scoring-inputs [data-step="1"]').first().click();
  await coach.click("#save-score");
  await expect(coach.locator("#save-state")).toHaveText("Retrying save...");
  await expect(coach.locator("#notice-message")).toContainText("Can't reach the shared Google Sheet");
  // Once saved, the usual confirmation replaces the warning.
  await expect(coach.locator("#notice-message")).toContainText("Q2 posted");
  await expect(coach.locator("#save-state")).toHaveText("");
  await expect(coach.locator("#match-status")).toHaveText("Posted");
  expect(await coach.evaluate(() => [window.__saves, window.__failSaves, EventStorage.conflicted])).toEqual([3, 0, false]);
  expect(errors).toEqual([]);
  await coach.context().close();
});

test("shared saves from different pages merge, and the same match changed twice is a conflict", async ({ browser, page }) => {
  const coach = await sharedPage(browser, page, { canEdit: true, role: "coach", email: "coach@nu-district.org", domain: "nu-district.org" });
  await coach.goto("/index.html");
  await expect(coach.locator("body")).not.toHaveClass(/read-only/);
  await coach.click('[data-tab="control"]');
  // Another operator renames a team; this page has not reloaded yet. Posting Q2 still saves, keeps their rename,
  // and the page then picks the rename up.
  await coach.evaluate(() => window.__publish(event => { event.teams[1].name = "Renamed elsewhere"; }));
  await coach.locator("#match-list button").nth(1).click();
  await coach.locator('#scoring-inputs [data-step="1"]').first().click();
  await coach.click("#save-score");
  await expect(coach.locator("#match-status")).toHaveText("Posted");
  expect(await coach.evaluate(() => EventStorage.conflicted)).toBe(false);
  const stored = () => coach.evaluate(() => { const event = JSON.parse(window.__current()); return [event.teams[1].name, Boolean(event.matches[1].result)]; });
  expect(await stored()).toEqual(["Renamed elsewhere", true]);
  await coach.locator("#match-list button").nth(0).click();
  await coach.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => coach.evaluate(() => state.teams[1].name)).toBe("Renamed elsewhere");

  // Both pages correct Q1: the second correction is refused instead of silently replacing the first.
  await coach.evaluate(() => window.__publish(event => { delete event.matches[0].result; }));
  await coach.locator("#match-list button").nth(0).click();
  await coach.locator('#scoring-inputs [data-step="1"]').nth(1).click();
  await coach.click("#save-score");
  await expect(coach.locator("#notice-message")).toContainText("match Q1");
  expect(await coach.evaluate(() => EventStorage.conflicted)).toBe(true);
  await coach.context().close();
});

async function review(page, team, note) {
  await page.click('[data-tab="rubric"]');
  await page.selectOption("#rubric-team", team);
  await page.fill("#rubric-date", "2026-10-01");
  await page.fill("#rubric-reviewer", "Coach Lee");
  await page.locator('#rubric-criteria .rubric-guidance-option[data-guidance-score="3"]').first().click();
  await page.locator("#rubric-criteria textarea").first().fill(note);
  await page.click("#save-rubric");
  await expect(page.locator("#rubric-history-rows tr")).toHaveCount(1);
}

test("shared-app viewers outside the editor domain get a results-only view that never saves", async ({ browser, page }) => {
  const viewer = await sharedViewerPage(browser, page);
  const errors = [];
  viewer.on("pageerror", error => errors.push(error.message));
  viewer.on("dialog", dialog => { errors.push(`Native dialog: ${dialog.message()}`); dialog.dismiss(); });
  await viewer.goto("/index.html#setup");
  await expect(viewer.locator("body")).toHaveClass(/read-only/);

  const visibleTabs = await viewer.locator("[data-tab]:visible").evaluateAll(buttons => buttons.map(button => button.dataset.tab));
  expect(visibleTabs).toEqual(["control", "rankings", "skills-rankings", "analysis"]);
  await expect(viewer.locator('[data-tab="control"]')).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.locator('[data-tab="control"]')).toHaveText("Schedule");
  await expect(viewer.locator("#match-list")).toBeVisible();
  await expect(viewer.locator(".field-control")).toBeHidden();
  await expect(viewer.locator("#generate-finals")).toBeHidden();
  await expect(viewer.locator("#notice-message")).toContainText("parent@gmail.com can view results only");
  await expect(viewer.locator("#notice-message")).toContainText("Settings > Manage access");
  await expect(viewer.locator("#footer-storage")).toHaveText("Read-only results from the shared Google Sheet");

  await viewer.click('[data-tab="rankings"]');
  await expect(viewer.locator("#standings tr")).toHaveCount(4);
  await viewer.click('[data-tab="analysis"]');
  await expect(viewer.locator("#analysis-rows tr")).toHaveCount(4);

  // No printing, exports, settings, or score history; the page keeps itself up to date instead.
  for (const id of ["#open-settings", "#open-history"]) await expect(viewer.locator(id)).toBeHidden();
  await viewer.click('[data-tab="skills-rankings"]');
  await viewer.click('[data-tab="control"]');
  await expect(viewer.locator("#print-schedule")).toBeHidden();
  await expect(viewer.locator("#export-finals")).toBeHidden();
  await viewer.goto("/index.html#history");
  await expect(viewer.locator("body")).toHaveClass(/read-only/);
  await expect(viewer.locator("#history-view")).toBeHidden();

  expect(await viewer.evaluate(() => persist())).toBe(false);
  expect(await viewer.evaluate(() => window.__saves)).toBe(0);
  expect(errors).toEqual([]);
  await viewer.context().close();
});

test("team members can review any team, read their own team's feedback, and save practice but not matches or skills", async ({ browser, page }) => {
  const member = await sharedPage(browser, page, { canEdit: true, role: "member", team: "2A", email: "student@nu-district.org", domain: "nu-district.org" }, async local => {
    await review(local, "1A", "Team one note");
    await review(local, "2A", "Team two note");
  });
  const errors = [];
  member.on("pageerror", error => errors.push(error.message));
  await member.goto("/index.html#setup");
  await expect(member.locator("body")).toHaveClass(/member/);
  await expect(member.locator("body")).not.toHaveClass(/read-only/);
  const visibleTabs = await member.locator("[data-tab]:visible").evaluateAll(buttons => buttons.map(button => button.dataset.tab));
  expect(visibleTabs).toEqual(["rankings", "skills-rankings", "practice", "rubric", "interview", "analysis"]);
  await expect(member.locator('[data-tab="practice"]')).toHaveAttribute("aria-pressed", "true");
  await expect(member.locator("#footer-storage")).toHaveText("Team 2A member / scores saved to the shared Google Sheet");
  await expect(member.locator("#associated-team")).toHaveText("Your team: 2A / Two");
  await expect(member.locator("#open-history")).toBeHidden();
  for (const name of ["control", "skills"]) {
    await member.goto(`/index.html#${name}`);
    await expect(member.locator("body")).toHaveClass(/member/);
    await expect(member.locator(`#${name}-view`)).toBeHidden();
  }
  let saves = await member.evaluate(() => window.__saves);

  // Practice: save a new run; saved runs have no Edit button.
  await member.click('[data-tab="practice"]');
  await expect(member.locator("#practice-team")).toHaveValue("2A");
  await expect(member.locator("#practice-partner")).not.toHaveValue("2A");
  await member.locator('#practice-scoring-inputs [data-step="1"]').first().click();
  await member.click("#save-practice");
  await expect(member.locator("#practice-runs tr")).toHaveCount(1);
  await expect(member.locator("#practice-runs")).toContainText("Student run (not ranked)");
  await expect(member.locator("#practice-ranking-note")).toContainText("not leaderboards");
  await expect(member.locator("#practice-runs tr td").first()).not.toHaveText("No practice runs saved.");
  await expect(member.locator("#practice-runs button")).toHaveCount(0);
  await expect(member.locator("#practice-actions-heading")).toBeHidden();
  await expect(member.locator("#practice-runs tr").first().locator("td")).toHaveCount(5);
  await expect.poll(() => member.evaluate(() => window.__saves)).toBeGreaterThan(saves);
  saves = await member.evaluate(() => window.__saves);

  // All teams can be reviewed, but another team's coach feedback stays hidden.
  await member.click('[data-tab="rubric"]');
  await expect(member.locator("#rubric-team option")).toHaveCount(4);
  await expect(member.locator("#rubric-team")).toHaveValue("2A");
  await expect(member.locator("#rubric-form")).toBeVisible();
  await expect(member.locator("#rubric-history-rows tr")).toHaveCount(1);
  await expect(member.locator("#rubric-history-rows [data-review-edit], #rubric-history-rows [data-review-delete]")).toHaveCount(0);
  await member.locator("#rubric-history-rows [data-review-notes]").first().click();
  await expect(member.locator("#rubric-history-rows [data-review-notes]").first()).toHaveAttribute("aria-expanded", "true");
  await expect(member.locator("#rubric-history-rows .review-notes").first()).toContainText("Team two note");
  await expect(member.locator("#rubric-history-rows .review-notes").first()).toContainText("Not scored");
  await expect(member.locator("#rubric-current")).not.toBeEmpty();
  await expect(member.locator("#rubric-rows tr")).toHaveCount(1);
  await member.selectOption("#rubric-team", "1A");
  await expect(member.locator("#rubric-history-rows")).not.toContainText("Team one note");
  await expect(member.locator("#rubric-history-rows [data-review-notes]")).toHaveCount(0);
  await member.click('[data-tab="interview"]');
  await expect(member.locator("#interview-team")).toHaveValue("2A");
  await expect(member.locator("#interview-form")).toBeVisible();

  await member.click("#open-settings");
  await expect(member.locator("#settings-event-data")).toBeHidden();
  await expect(member.locator("#sound")).toBeHidden();
  await member.keyboard.press("Escape");

  // Score history cannot be opened by URL either.
  await member.goto("/index.html#history");
  await expect(member.locator("body")).toHaveClass(/member/);
  await expect(member.locator("#history-view")).toBeHidden();
  expect(errors).toEqual([]);
  await member.context().close();
});

test("coaches manage the access list from Settings; it is not offered outside the shared app", async ({ browser, page }) => {
  const coach = await sharedPage(browser, page, { canEdit: true, role: "coach", team: "", email: "owner@nu-district.org", domain: "nu-district.org" });
  await page.click("#open-settings");
  await expect(page.locator("#open-access")).toBeHidden();
  await page.click("#close-settings");
  const errors = [];
  coach.on("pageerror", error => errors.push(error.message));
  coach.on("dialog", dialog => { errors.push(`Native dialog: ${dialog.message()}`); dialog.dismiss(); });
  await coach.goto("/index.html#setup");
  await expect(coach.locator('[data-tab="access"]')).toHaveCount(0);
  await coach.click("#open-settings");
  await coach.click("#open-access");
  await expect(coach.locator("#settings-tray")).not.toHaveAttribute("open", "");
  await expect(coach.locator("#access-view")).toBeVisible();
  await expect(coach.locator("#access-owner")).toHaveText("owner@nu-district.org");
  await expect(coach.locator("#access-rows tr")).toHaveCount(1);
  expect(await coach.evaluate(() => window.__accessLoads)).toBe(1);

  await coach.click("#open-settings");
  await coach.click("#open-access");
  await expect.poll(() => coach.evaluate(() => window.__accessLoads)).toBe(2);

  await coach.fill("#access-name", "Parent Example");
  await coach.fill("#access-email", "parent@gmail.com");
  await coach.click("#save-access");
  await expect(coach.locator("#notice-message")).toContainText("Only @nu-district.org accounts");
  expect(await coach.evaluate(() => window.__access.length)).toBe(0);

  await coach.fill("#access-name", "Sam Student");
  await coach.fill("#access-email", "Student@NU-District.org");
  await coach.selectOption("#access-team", "3A");
  await coach.click("#save-access");
  await expect(coach.locator("#notice-message")).toContainText("student@nu-district.org added as a team 3A member");
  await coach.fill("#access-name", "Coach Lee");
  await coach.fill("#access-email", "lee@nu-district.org");
  await coach.selectOption("#access-role", "coach");
  await expect(coach.locator("#access-team")).toBeDisabled();
  await coach.click("#save-access");
  await expect(coach.locator("#access-rows tr")).toHaveCount(3);
  await expect(coach.locator("#access-rows tr").nth(1)).toContainText("Coach Lee");
  await expect(coach.locator("#access-rows tr").nth(1)).toContainText("lee@nu-district.org");
  await expect(coach.locator("#access-rows tr").nth(2)).toContainText("Sam Student");
  await expect(coach.locator("#access-rows tr").nth(2)).toContainText("3A");
  expect(await coach.evaluate(() => window.__access)).toEqual([{ name: "Sam Student", email: "student@nu-district.org", role: "member", team: "3A" }, { name: "Coach Lee", email: "lee@nu-district.org", role: "coach", team: "" }]);

  await coach.click('[aria-label="Remove student@nu-district.org"]');
  await expect(coach.locator("#access-rows tr")).toHaveCount(2);
  expect(await coach.evaluate(() => window.__access.map(entry => entry.email))).toEqual(["lee@nu-district.org"]);
  expect(errors).toEqual([]);
  await coach.context().close();
});

test("the local role preview shows the member view using the server's rules without changing local data", async ({ page }) => {
  const errors = await openApp(page);
  await schedule(page, [["1A", "One"], ["2A", "Two"], ["3A", "Three"], ["4A", "Four"]], 1);
  await review(page, "1A", "Team one note");
  await review(page, "2A", "Team two note");
  const before = await page.evaluate(() => JSON.stringify(state));

  await page.goto("/preview.html");
  await page.selectOption("#preview-data", "local");
  await expect(page.locator("#preview-team option")).toHaveCount(4);
  await page.selectOption("#preview-team", "2A");
  await page.click("button[type=submit]");
  await expect(page.locator("body")).toHaveClass(/member/);
  await expect(page.getByText("Preview as Team 2A member")).toBeVisible();
  await expect(page.locator('[data-tab="setup"]')).toBeHidden();
  await expect(page.locator("#footer-storage")).toHaveText("Team 2A member / scores saved to the shared Google Sheet");
  await page.click('[data-tab="rubric"]');
  await expect(page.locator("#rubric-team option")).toHaveCount(4);
  await expect(page.locator("#rubric-form")).toBeVisible();
  expect(JSON.stringify(await page.evaluate(() => state.rubrics))).not.toContain("Team one note");
  expect(JSON.stringify(await page.evaluate(() => state.rubrics))).toContain("Team two note");

  // The real server rules allow student reviews for other teams without changing coach scores.
  const ranking = await page.evaluate(() => JSON.stringify(analysisRanking()));
  for (const [prefix, tabName, criterion] of [["rubric", "rubric", "navigation"], ["interview", "interview", "own-work"]]) {
    await page.click(`[data-tab="${tabName}"]`);
    await page.selectOption(`#${prefix}-team`, "1A");
    await expect(page.locator(`#${prefix}-form-title`)).toContainText("New student review");
    await page.locator(`#${prefix}-guidance-${criterion} [data-guidance-score="2"]`).click();
    await page.fill(`#${prefix}-overall`, "Feedback from another team");
    await page.click(`#save-${prefix}`);
    await expect(page.locator(`#${prefix}-history-rows`)).toContainText("Student review (not ranked)");
    await expect(page.locator(`#${prefix}-history-rows [data-review-edit]`)).toHaveCount(1);
    await page.locator(`#${prefix}-history-rows [data-review-notes]`).click();
    await expect(page.locator(`#${prefix}-history-rows .review-notes`)).toContainText("Feedback from another team");
    await expect(page.locator(`#${prefix}-history-rows .review-notes`)).not.toContainText("Team one note");
    await page.locator(`#${prefix}-history-rows [data-review-edit]`).click();
    await page.fill(`#${prefix}-overall`, "Revised student feedback");
    await page.click(`#save-${prefix}`);
    await expect(page.locator(`#${prefix}-history-rows .review-notes`)).toContainText("Revised student feedback");
    expect(await page.evaluate(() => JSON.stringify(analysisRanking()))).toBe(ranking);
    await page.locator(`#${prefix}-history-rows [data-review-delete]`).click();
    await expect(page.locator(`#${prefix}-history-rows [data-review-edit]`)).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(analysisRanking()))).toBe(ranking);
  }

  await expect(page.locator('[data-tab="control"]')).toBeHidden();
  await expect(page.locator('[data-tab="skills"]')).toBeHidden();
  await page.click('[data-tab="practice"]');
  await page.selectOption("#practice-team", "2A");
  const practiceRanks = await page.evaluate(() => JSON.stringify([History.skillsRanking(state.history, state.teams), History.teamworkRanking(state.history, state.teams)]));
  await expect(page.locator("#practice-ranking-note")).toContainText("not leaderboards");
  await page.locator('#practice-scoring-inputs [data-step="1"]').first().click();
  await page.click("#save-practice");
  await expect(page.locator("#practice-runs tr")).toHaveCount(1);
  await expect(page.locator("#practice-runs button")).toHaveCount(0);
  await expect(page.locator("#practice-runs")).toContainText("Student run (not ranked)");
  expect(await page.evaluate(() => JSON.stringify(analysisRanking()))).toBe(ranking);
  expect(await page.evaluate(() => JSON.stringify([History.skillsRanking(state.history, state.teams), History.teamworkRanking(state.history, state.teams)]))).toBe(practiceRanks);
  expect(await page.evaluate(() => History.teamAnalysis(state.history, "2A").modes.driver.count)).toBe(1);
  // The server's rules refuse a match result from a team member even if the page is bypassed.
  await page.evaluate(() => tab("control"));
  await page.locator('#scoring-inputs [data-step="1"]').first().click();
  await page.click("#save-score");
  await expect(page.locator("#notice-message")).toContainText("Coach access required to score matches or skills");

  await page.goto("/index.html");
  await expect(page.locator("#save-state")).toHaveText("");
  expect(await page.evaluate(() => JSON.stringify(state))).toBe(before);
  expect(errors).toEqual([]);
});

test("the role preview offers a sample event so a student view can be checked with no local data", async ({ page }) => {
  const errors = await openApp(page);
  await page.goto("/preview.html");
  await expect(page.locator('#preview-data option[value="local"]')).toHaveAttribute("disabled", "");
  await expect(page.locator("#preview-team option")).toHaveCount(6);
  await page.selectOption("#preview-team", "1A");
  await page.click("button[type=submit]");
  await expect(page.getByText("Preview as Team 1A member (sample event)")).toBeVisible();
  await expect(page.locator("#practice-view")).toBeVisible();
  await page.click('[data-tab="rankings"]');
  await expect(page.locator("#standings tr")).toHaveCount(6);
  await page.click('[data-tab="rubric"]');
  await expect(page.locator("#rubric-team option")).toHaveCount(6);
  await expect(page.locator("#rubric-history-rows tr")).toHaveCount(2);
  await expect(page.locator("#rubric-current")).not.toBeEmpty();
  const rubrics = JSON.stringify(await page.evaluate(() => state.rubrics));
  expect(rubrics).toContain("Sample note for 1A");
  expect(rubrics).not.toContain("Sample note for 2B");
  await page.click('[data-tab="practice"]');

  await page.goto("/preview.html?data=sample&role=viewer");
  await expect(page.locator("body")).toHaveClass(/read-only/);
  await expect(page.locator('[data-tab="control"]')).toBeVisible();
  expect(JSON.stringify(await page.evaluate(() => state))).not.toMatch(/Sample (note|overall|practice|design)/);
  await page.goto("/index.html");
  await expect(page.locator("#save-state")).toHaveText("");
  expect(await page.evaluate(() => state.teams.length)).toBe(0);
  expect(errors).toEqual([]);
});

test("read-only viewers see the Schedule tab only once a schedule exists", async ({ page }) => {
  const errors = await openApp(page);
  await addTeams(page, [["1A", "One"], ["2A", "Two"]]);
  await page.goto("/preview.html?data=local&role=viewer");
  await expect(page.locator("body")).toHaveClass(/read-only/);
  await expect(page.locator('[data-tab="control"]')).toBeHidden();
  await expect(page.locator('[data-tab="rankings"]')).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});
