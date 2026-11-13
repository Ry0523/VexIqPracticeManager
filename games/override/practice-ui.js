/** V5 practice view adapter. The shared controller calls render/read/update/handleClick only. */
(function (root) {
  "use strict";
  const views = root.VexGamePracticeViews = root.VexGamePracticeViews || {};

  /**
   * Create the Override field view that plugs into shared PracticeUI.
   * @param {{container: HTMLElement, game: import("../../types").GameDefinition<import("../../types").OverrideGoals, import("../../types").V5PracticeData, import("../../types").V5PracticeEvaluation>, escapeText: (value: string) => string}} context Host element, game rules, and HTML escaping helper.
   * @returns {import("../../types").PracticeView<import("../../types").V5PracticeData, import("../../types").V5PracticeEvaluation>} Adapter implementing the shared practice-view contract.
   */
  views.override = ({ container, game, escapeText }) => {
    const field = game.practice.field;

    function counter(path, label, value, color = "neutral", max = 16) {
      const id = `practice-field-${path.replaceAll(".", "-")}`;
      const minReached = Number(value) <= 0;
      const maxReached = max !== null && Number(value) >= max;
      return `<div class="v5-count ${color}"><div class="v5-stepper"><button type="button" data-step="-1" data-counter="${id}" aria-label="Decrease ${escapeText(label)}" title="Remove one"${minReached ? " disabled" : ""}>&minus;</button><input id="${id}" type="number" inputmode="numeric" min="0"${max === null ? "" : ` max="${max}"`} data-v5-path="${path}" step="1" value="${value}" required readonly aria-label="${escapeText(label)}"><button type="button" data-step="1" data-counter="${id}" aria-label="Increase ${escapeText(label)}" title="Add one"${maxReached ? " disabled" : ""}>+</button></div></div>`;
    }

    function toggle(path, value, label) {
      const id = `practice-field-${path.replaceAll(".", "-")}`;
      const icons = {
        red: '<span class="toggle-icon toggle-icon-left" aria-hidden="true"></span>',
        yellow: '<span class="toggle-icon toggle-icon-neutral" aria-hidden="true">X</span>',
        blue: '<span class="toggle-icon toggle-icon-right" aria-hidden="true"></span>'
      };
      return `<div class="v5-toggle"><span>${escapeText(label)}</span><div role="group" aria-label="${escapeText(label)} state">${["red", "yellow", "blue"].map(color => `<button type="button" class="toggle-${color}" data-v5-toggle="${path}" data-toggle-value="${color}" aria-label="Set ${escapeText(label)} to ${color}" aria-pressed="${value === color}" title="Set ${escapeText(label)} to ${color}">${icons[color]}</button>`).join("")}</div><input id="${id}" type="hidden" data-v5-path="${path}" value="${value}"></div>`;
    }

    /** @param {{mode: import("../../types").PracticeMode, data: import("../../types").V5PracticeData}} context Selected mode and current field data. @returns {void} Replaces the host contents with the game-specific scorecard. */
    function render({ mode, data }) {
      const teamwork = mode === "teamwork";
      const scores = `<div id="v5-teamwork-scores" class="v5-teamwork-scores" aria-live="polite"${teamwork ? "" : " hidden"}><div class="v5-alliance-score red"><span class="v5-alliance-name">Red Alliance</span><div class="v5-alliance-points"><output id="v5-red-score">0</output><span>POINTS</span></div><button id="v5-autonomous-red" class="v5-autonomous-award red" type="button" data-autonomous-bonus="red" aria-label="Red Autonomous Bonus" aria-pressed="${data.autonomousBonus.red}" title="Red Autonomous Bonus"><span aria-hidden="true">A</span></button></div><div class="v5-alliance-score blue"><button id="v5-autonomous-blue" class="v5-autonomous-award blue" type="button" data-autonomous-bonus="blue" aria-label="Blue Autonomous Bonus" aria-pressed="${data.autonomousBonus.blue}" title="Blue Autonomous Bonus"><span aria-hidden="true">A</span></button><div class="v5-alliance-points"><output id="v5-blue-score">0</output><span>POINTS</span></div><span class="v5-alliance-name">Blue Alliance</span></div></div>`;
      const quadrants = field.quadrants.map((quadrant, index) => {
        const current = data.quadrants[index];
        const colors = teamwork ? ["yellow", "red", "blue"] : ["yellow", quadrant.alliance];
        return `<section class="v5-quadrant toggle-${current.toggle}"><h3>${escapeText(quadrant.label)}</h3><div class="v5-pin-counts">${colors.map(color => counter(`quadrants.${index}.${color}`, `${color[0].toUpperCase()}${color.slice(1)} Pin Halves`, current[color], color)).join("")}</div>${toggle(`quadrants.${index}.toggle`, current.toggle, "Toggle")}</section>`;
      }).join("");
      const midfield = data.midfield;
      const robotChecks = (alliance, count, limit) => Array.from({ length: limit }, (_, index) => `<label class="v5-robot-check ${alliance}"><input type="checkbox" data-v5-robot="${alliance}"${index < count ? " checked" : ""}><span>${limit === 1 ? "Robot" : `Robot ${index + 1}`}</span></label>`).join("");
      const midfieldPins = `<div class="v5-midfield-pins">${["yellow", "red", "blue"].map(color => counter(`midfield.${color}`, `${color[0].toUpperCase()}${color.slice(1)} Pin Halves`, midfield[color], color)).join("")}</div>`;
      const midfieldRobots = teamwork
        ? `<div class="v5-midfield-layout"><div class="v5-midfield-alliance red"><h4>Red Alliance</h4>${robotChecks("red", midfield.redRobots, 2)}</div>${midfieldPins}<div class="v5-midfield-alliance blue"><h4>Blue Alliance</h4>${robotChecks("blue", midfield.blueRobots, 2)}</div></div>`
        : `<div class="v5-midfield-layout solo"><div class="v5-midfield-alliance solo"><h4>Skills Robot</h4>${robotChecks("solo", midfield.redRobots, 1)}</div>${midfieldPins}</div>`;
      container.innerHTML = `${scores}<div class="v5-field-layout"><div class="v5-field">${quadrants}<div class="v5-field-center" aria-hidden="true"><span class="field-marker-dot red"></span><span class="field-marker-dot blue"></span><span class="field-marker-dot red"></span><span class="field-marker-dot blue"></span></div></div><section class="v5-midfield highlight-${teamwork ? midfield.redRobots === midfield.blueRobots ? "neutral" : midfield.redRobots > midfield.blueRobots ? "red" : "blue" : "neutral"}"><h3>Midfield Goal</h3>${midfieldRobots}</section></div>`;
    }

    /** @param {import("../../types").PracticeMode} mode Current practice mode. @returns {import("../../types").V5PracticeData} Field state reconstructed from controls; omitted Skills-only controls become zero/false. */
    function read(mode) {
      const data = field.empty();
      const readValue = path => {
        const input = container.querySelector(`[data-v5-path="${path}"]`);
        if (!input && mode !== "teamwork" && path === "midfield.blueRobots") return 0;
        if (!input && mode !== "teamwork" && path.startsWith("autonomousBonus.")) return false;
        const omittedSkillsPin = path.match(/^quadrants\.(\d+)\.(red|blue)$/);
        if (!input && omittedSkillsPin && field.quadrants[Number(omittedSkillsPin[1])]?.alliance !== omittedSkillsPin[2]) return 0;
        if (!input) throw new Error(`Missing practice field data: ${path}`);
        return input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
      };
      field.quadrants.forEach((quadrant, index) => {
        for (const color of ["red", "blue", "yellow", "toggle"]) data.quadrants[index][color] = readValue(`quadrants.${index}.${color}`);
      });
      for (const color of ["red", "blue", "yellow"]) data.midfield[color] = readValue(`midfield.${color}`);
      data.midfield.redRobots = container.querySelectorAll('[data-v5-robot="red"]:checked').length + container.querySelectorAll('[data-v5-robot="solo"]:checked').length;
      data.midfield.blueRobots = container.querySelectorAll('[data-v5-robot="blue"]:checked').length;
      data.autonomousBonus.red = container.querySelector('[data-autonomous-bonus="red"]')?.getAttribute("aria-pressed") === "true";
      data.autonomousBonus.blue = container.querySelector('[data-autonomous-bonus="blue"]')?.getAttribute("aria-pressed") === "true";
      return data;
    }

    /** @param {{mode: import("../../types").PracticeMode, result: import("../../types").V5PracticeEvaluation|null}} context Mode and latest scoring result, or null when invalid. @returns {void} Refreshes counter limits, alliance scores, and field highlights. */
    function update({ mode, result }) {
      const teamwork = mode === "teamwork";
      container.querySelectorAll(".v5-stepper").forEach(stepper => {
        const input = stepper.querySelector("input");
        stepper.querySelector('[data-step="-1"]').disabled = Number(input.value) <= Number(input.min || 0);
        stepper.querySelector('[data-step="1"]').disabled = input.max !== "" && Number(input.value) >= Number(input.max);
      });
      container.querySelectorAll(".v5-quadrant").forEach((quadrant, index) => {
        quadrant.classList.remove("toggle-red", "toggle-yellow", "toggle-blue");
        quadrant.classList.add(`toggle-${read(mode).quadrants[index].toggle}`);
      });
      container.querySelector("#v5-teamwork-scores").hidden = !teamwork;
      if (result?.kind === "scrimmage") {
        container.querySelector("#v5-red-score").textContent = result.scores.red.score;
        container.querySelector("#v5-blue-score").textContent = result.scores.blue.score;
      } else {
        container.querySelector("#v5-red-score").textContent = "--";
        container.querySelector("#v5-blue-score").textContent = "--";
      }
      const data = read(mode);
      const lead = data.midfield.redRobots === data.midfield.blueRobots ? "neutral" : data.midfield.redRobots > data.midfield.blueRobots ? "red" : "blue";
      const midfield = container.querySelector(".v5-midfield");
      for (const color of ["red", "blue", "neutral"]) midfield.classList.toggle(`highlight-${color}`, (teamwork ? lead : "neutral") === color);
    }

    /** @param {MouseEvent} event Delegated click from the scorecard host. @returns {boolean} True if the adapter handled the click. */
    function handleClick(event) {
      if (event.target.closest("[data-v5-robot]")) return true;
      const toggleButton = event.target.closest("[data-v5-toggle]");
      if (toggleButton) {
        const path = toggleButton.dataset.v5Toggle;
        const value = toggleButton.dataset.toggleValue;
        container.querySelector(`[data-v5-path="${path}"]`).value = value;
        container.querySelectorAll(`[data-v5-toggle="${path}"]`).forEach(button => button.setAttribute("aria-pressed", String(button === toggleButton)));
        return true;
      }
      const autonomous = event.target.closest("[data-autonomous-bonus]");
      if (autonomous) {
        autonomous.setAttribute("aria-pressed", String(autonomous.getAttribute("aria-pressed") !== "true"));
        return true;
      }
      return false;
    }

    return { render, read, update, handleClick };
  };
})(globalThis);