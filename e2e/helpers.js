"use strict";
const { expect } = require("@playwright/test");

// The app asks for confirmation with its own dialog. Accept it by default; a test can set window.__confirmAnswer = false
// to cancel instead (or null to answer by hand), and read the messages it showed from window.__confirms.
async function autoConfirm(page) {
  await page.addInitScript(() => {
    window.__confirms = [];
    window.__confirmAnswer = true;
    new MutationObserver(() => {
      const dialog = document.getElementById("confirm-dialog");
      if (!dialog?.open || window.__confirmAnswer === null) return;
      window.__confirms.push(document.getElementById("confirm-message").textContent);
      document.getElementById(window.__confirmAnswer ? "confirm-ok" : "confirm-cancel").click();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["open"] });
  });
}

// Native alert/confirm/prompt dialogs are reported as errors: in the Apps Script frame Android labels them
// "An embedded page at ... says".
function rejectNativeDialogs(page, errors) {
  page.on("dialog", dialog => {
    if (dialog.type() === "beforeunload") return dialog.accept();
    errors.push(`Native ${dialog.type()} dialog: ${dialog.message()}`);
    return dialog.dismiss();
  });
}

// Each test gets a fresh browser context, so IndexedDB starts empty.
async function openApp(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  rejectNativeDialogs(page, errors);
  await autoConfirm(page);
  await page.goto("/index.html");
  await expect(page.locator("#save-state")).toHaveText("");
  return errors;
}

async function addTeams(page, teams) {
  for (const [id, name] of teams) {
    await page.fill("#team-id", id);
    await page.fill("#team-name", name);
    await page.click("#save-team");
  }
}

async function schedule(page, teams, rounds = 6) {
  await addTeams(page, teams);
  await page.fill("#rounds", String(rounds));
  await page.locator("#schedule-form button[type=submit]").click();
  await expect(page.locator('[data-tab="control"]')).toHaveAttribute("aria-pressed", "true");
}

// Removes Web Audio so the timer uses its visual-only clock, and fakes time so a 60-second match runs instantly.
async function useFakeTimerClock(page) {
  await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
  await page.clock.install();
}

module.exports = { openApp, addTeams, schedule, useFakeTimerClock, autoConfirm, rejectNativeDialogs };
