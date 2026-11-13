(function (root) {
  "use strict";
  // VEX IQ game definition. Scoring, layout, standings configuration, and manual links for this season live here.
  // game.js handles registration and the active-game flag.
  const POINTS = [1, 3, 6, 12, 16];
  const MAX_BAGS = 38;
  const LEVELS = ["Floor", "L1", "L2", "L3"];
  /**
   * Returns whether the value is a nonnegative integer.
   *
   * @param {unknown} value - Candidate bag count.
   * @returns {boolean}
   */
  const isCount = (value) => Number.isInteger(value) && value >= 0;

  /**
   * Returns validated total points; throws for invalid counts or more than 38 bags.
   *
   * @param {number[]} counts - Counts ordered Floor, L1, L2, L3, L4.
   * @returns {number}
   */
  function score(counts) {
    if (
      !Array.isArray(counts) ||
      counts.length !== POINTS.length ||
      counts.some((value) => !isCount(value)) ||
      counts.reduce((sum, value) => sum + value, 0) > MAX_BAGS
    ) {
      throw new Error(`Enter whole bag counts, with no more than ${MAX_BAGS} bags total.`);
    }
    return counts.reduce((sum, value, index) => sum + value * POINTS[index], 0);
  }

  /**
   * Creates zeroed counts for blue, red, unassigned, and shared-top goals.
   *
   * @returns {import("../../types").LevelUpGoals}
   */
  function emptyGoals() {
    return { blue: [0, 0, 0, 0], red: [0, 0, 0, 0], unassigned: [0, 0, 0, 0], top: 0 };
  }

  /**
   * Returns aggregate counts ordered Floor, L1, L2, L3, L4.
   *
   * @param {import("../../types").LevelUpGoals} goals - Goal-location breakdown.
   * @returns {number[]}
   */
  function goalCounts(goals) {
    if (
      !goals ||
      ![goals.blue, goals.red, goals.unassigned].every(
        (group) => Array.isArray(group) && group.length === 4 && group.every(isCount),
      ) ||
      !isCount(goals.top)
    ) {
      throw new Error("Enter whole, nonnegative bag counts for each goal.");
    }
    const counts = goals.blue.map((value, index) => value + goals.red[index] + goals.unassigned[index]);
    counts.push(goals.top);
    score(counts);
    return counts;
  }

  /**
   * Returns goal shape with legacy lower-level counts assigned to unassigned goals.
   *
   * @param {number[]} counts - Valid aggregate counts ordered Floor through L4.
   * @returns {import("../../types").LevelUpGoals}
   */
  function goalsFromCounts(counts) {
    score(counts);
    return { ...emptyGoals(), unassigned: counts.slice(0, 4), top: counts[4] };
  }

  const tower =
    '<div class="goal-diagram goal-visual" aria-hidden="true"><div class="tower-tier tower-l3">L3</div><div class="tower-tier tower-l2">L2</div><div class="tower-tier tower-l1">L1</div><div class="tower-floor">Floor</div></div>';
  /**
   * Creates a game-layout group with one counter per tower level.
   *
   * @param {string} id - Goal-location key.
   * @param {string} short - Short alliance label.
   * @param {string} title - Accessible group title.
   * @param {string} color - CSS accent.
   * @param {string} wash - CSS background wash.
   * @param {Partial<import("../../types").GameLayoutGroup<import("../../types").LevelUpGoals>>} [extra={}] - Optional layout properties.
   * @returns {import("../../types").GameLayoutGroup<import("../../types").LevelUpGoals>}
   */
  const towerGroup = (id, short, title, color, wash, extra = {}) => ({
    id,
    title,
    color,
    wash,
    diagram: tower,
    inputs: [3, 2, 1, 0].map((level) => ({
      path: [id, level],
      label: LEVELS[level],
      ariaLabel: `${short} ${LEVELS[level]}`,
      element: level,
    })),
    ...extra,
  });

  /**
   * Complete Level Up game contract consumed by the registry and shared app.
   * Keep season-specific rules and presentation here so shared modules do not
   * need to branch on this game's ID.
   * @type {import("../../types").GameDefinition<import("../../types").LevelUpGoals>}
   */
  const definition = {
    // Stable persisted key plus labels used in the page and exports.
    id: "level-up",
    name: "Level Up",
    program: "VEX IQ",
    season: "2026\u20132027",
    // Asset and official-team-profile integration used by shared header/analysis UI.
    fieldImage: "games/level-up/field.png",
    teamProfileProgram: "VIQRC",
    // Source and team cohorts for the cached official Skills standings panel.
    officialStandings: {
      sourceUrl: "https://events.vex.com/robot-competitions/vex-iq-competition/standings/skills",
      apiUrl: "https://events.vex.com/api/seasons/203/skills?post_season=0",
      country: "United States",
      countryId: 244,
      region: "Ohio",
      regionId: 47,
      groups: [
        { gradeLevel: "Elementary", teamPrefix: "28101" },
        { gradeLevel: "Middle School", teamPrefix: "28102" },
      ],
    },
    // Manual URL and rule anchors used by shared rules links.
    manual: {
      url: "https://manuals.vex.com/iq/level-up/v2.1/event/",
      label: "Official rules v2.1",
      rules: {
        schedule: { anchor: "t9", label: "T9" },
        finals: { anchor: "t12", label: "T12-T14" },
        skills: { anchor: "t17", label: "T17" },
      },
    },
    // Labels and scoring weights consumed by the generic score calculator.
    scoring: {
      object: "bag",
      objects: "bags",
      maxObjects: MAX_BAGS,
      elements: [
        { id: "floor", label: "Floor", points: POINTS[0] },
        { id: "l1", label: "L1", points: POINTS[1] },
        { id: "l2", label: "L2", points: POINTS[2] },
        { id: "l3", label: "L3", points: POINTS[3] },
        { id: "l4", label: "L4", points: POINTS[4] },
      ],
    },
    // Convert game-owned goals to/from the shared aggregate count order.
    score,
    emptyGoals,
    goalCounts,
    goalsFromCounts,
    // Grouped controls for the shared calculator; paths address `emptyGoals()` fields.
    layout: [
      towerGroup("blue", "Blue", "Blue goal", "#79c9ff", "#183c53"),
      towerGroup("red", "Red", "Red goal", "#ff8c9c", "#4c2630"),
      towerGroup("unassigned", "Unassigned", "Unassigned goals", "#b4b4b4", "#303030", {
        optional: (goals) => goals.unassigned.some((count) => count > 0),
        note: "Goal colors not recorded in this earlier result.",
      }),
      {
        id: "top",
        title: "Shared top goal",
        color: "#f1ce68",
        wash: "#4b4126",
        diagram: '<div class="top-goal-diagram goal-visual" aria-hidden="true"><span>L4</span></div>',
        inputs: [{ path: ["top"], label: "L4", ariaLabel: "Shared L4", element: 4 }],
      },
    ],
    // T17 game-specific suffix after the shared Skills score and Stop Time criteria.
    /**
     * Returns T17 tie-break point values in L4, L3, then L2 order.
     *
     * @param {number[]} counts - Counts ordered Floor through L4.
     * @returns {number[]}
     */
    skillsTiebreak: (counts) => [counts[4] * POINTS[4], counts[3] * POINTS[3], counts[2] * POINTS[2]],
    // Column names and row projection for score-history CSV exports.
    csv: {
      headers: [
        ...["Floor", "L1", "L2", "L3", "L4"].map((level) => `${level} bags`),
        "Goal breakdown recorded",
        ...["Blue", "Red", "Unassigned"].flatMap((group) => LEVELS.map((level) => `${group} ${level} bags`)),
        "Shared L4 bags",
      ],
      /**
       * Builds CSV values from aggregate counts and any recorded goal-location breakdown.
       *
       * @param {{counts:number[],goals?:import("../../types").LevelUpGoals}} result - Saved result.
       * @returns {Array<number|boolean|string>}
       */
      values: (result) => [
        ...result.counts,
        Boolean(result.goals),
        ...["blue", "red", "unassigned"].flatMap((group) =>
          result.goals ? result.goals[group] : ["", "", "", ""],
        ),
        result.goals?.top ?? "",
      ],
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = definition;
  else (root.VexGameDefinitions = root.VexGameDefinitions || {})[definition.id] = definition;
})(globalThis);
