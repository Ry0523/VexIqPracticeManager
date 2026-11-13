(function (root) {
  "use strict";
  const isCount = value => Number.isInteger(value) && value >= 0;

  function score(counts) {
    if (!Array.isArray(counts) || counts.length !== 4 || counts.some(value => !isCount(value)) || counts[2] > 2 || counts[3] > 1) {
      throw new Error("Enter whole Pin Half counts, up to two Midfield Robots, and at most one Autonomous Bonus.");
    }
    return counts[0] * 5 + counts[1] * 10 + counts[2] * 8 + counts[3] * 12;
  }

  function emptyGoals() {
    return { alliance: 0, yellow: 0, midfield: 0, autonomousBonus: 0 };
  }

  function goalCounts(goals) {
    if (!goals || ![goals.alliance, goals.yellow, goals.midfield, goals.autonomousBonus].every(isCount)) {
      throw new Error("Enter whole, nonnegative Override scoring counts.");
    }
    const counts = [goals.alliance, goals.yellow, goals.midfield, goals.autonomousBonus];
    score(counts);
    return counts;
  }

  function goalsFromCounts(counts) {
    score(counts);
    return { alliance: counts[0], yellow: counts[1], midfield: counts[2], autonomousBonus: counts[3] };
  }

  /** @type {import("../../types").V5Quadrant[]} */
  const practiceQuadrants = [
    { id: "red-upper", label: "Red quadrant 1", alliance: "red" },
    { id: "blue-upper", label: "Blue quadrant 1", alliance: "blue" },
    { id: "red-lower", label: "Red quadrant 2", alliance: "red" },
    { id: "blue-lower", label: "Blue quadrant 2", alliance: "blue" }
  ];

  /** @returns {import("../../types").V5PracticeData} Fresh, zeroed V5 field state. */
  function emptyPracticeGoals() {
    return {
      quadrants: practiceQuadrants.map(quadrant => ({ ...quadrant, red: 0, blue: 0, yellow: 0, toggle: "yellow" })),
      midfield: { red: 0, blue: 0, yellow: 0, redRobots: 0, blueRobots: 0 },
      autonomousBonus: { red: false, blue: false }
    };
  }

  /** @param {import("../../types").V5PracticeData} goals V5 quadrant, Midfield, and Autonomous Bonus data. @returns {import("../../types").V5PracticeData} The validated input. */
  function validatePracticeGoals(goals) {
    const count = value => Number.isInteger(value) && value >= 0;
    if (!goals || !Array.isArray(goals.quadrants) || goals.quadrants.length !== practiceQuadrants.length) throw new Error("Record all four Override quadrants.");
    for (const [index, quadrant] of practiceQuadrants.entries()) {
      const actual = goals.quadrants[index];
      if (!actual || actual.id !== quadrant.id || actual.alliance !== quadrant.alliance || ![actual.red, actual.blue, actual.yellow].every(count) || !["red", "blue", "yellow"].includes(actual.toggle)) throw new Error("Enter valid Pin Half counts and Toggle states for every quadrant.");
    }
    const midfield = goals.midfield;
    if (!midfield || ![midfield.red, midfield.blue, midfield.yellow, midfield.redRobots, midfield.blueRobots].every(count) || midfield.redRobots > 2 || midfield.blueRobots > 2 || !goals.autonomousBonus || [goals.autonomousBonus.red, goals.autonomousBonus.blue].some(value => typeof value !== "boolean")) throw new Error("Enter valid Midfield counts, robot positions, and Autonomous Bonuses.");
    return goals;
  }

  /** @param {import("../../types").V5PracticeData} goals Recorded four-quadrant Teamwork field state. @returns {Record<"red"|"blue", {counts: number[], score: number}>} Per-alliance counts and scores. */
  function practiceTeamworkScores(goals) {
    validatePracticeGoals(goals);
    const midfield = goals.midfield;
    const sharedBonusAdjustment = goals.autonomousBonus.red && goals.autonomousBonus.blue ? 6 : 0;
    return Object.fromEntries(["red", "blue"].map(alliance => {
      const opposing = alliance === "red" ? "blue" : "red";
      const alliancePins = goals.quadrants.reduce((sum, quadrant) => sum + quadrant[alliance], 0) + midfield[alliance];
      const quadrantYellow = goals.quadrants.filter(quadrant => quadrant.toggle === alliance).reduce((sum, quadrant) => sum + quadrant.yellow, 0);
      const midfieldYellow = midfield[`${alliance}Robots`] > midfield[`${opposing}Robots`] ? midfield.yellow : 0;
      const counts = [alliancePins, quadrantYellow + midfieldYellow, midfield[`${alliance}Robots`], Number(goals.autonomousBonus[alliance])];
      return [alliance, { counts, score: score(counts) - sharedBonusAdjustment }];
    }));
  }

  /** @param {import("../../types").V5PracticeData} goals Recorded field state for one Skills robot. @returns {{counts: number[], score: number}} Aggregate counts and score; throws if multiple Midfield robots are set. */
  function practiceSkillsScore(goals) {
    validatePracticeGoals(goals);
    const midfield = goals.midfield;
    if (midfield.redRobots + midfield.blueRobots > 1) throw new Error("A Robot Skills run has at most one Robot in the Midfield.");
    const alliancePins = goals.quadrants.reduce((sum, quadrant) => sum + quadrant[quadrant.alliance], 0) + midfield.red + midfield.blue;
    const quadrantYellow = goals.quadrants.filter(quadrant => quadrant.toggle === quadrant.alliance).reduce((sum, quadrant) => sum + quadrant.yellow, 0);
    const midfieldYellow = midfield.redRobots + midfield.blueRobots > 0 ? midfield.yellow : 0;
    const counts = [alliancePins, quadrantYellow + midfieldYellow, midfield.redRobots + midfield.blueRobots, 0];
    return { counts, score: score(counts) };
  }

  /** Validate and evaluate opaque gameData for shared practice history and analysis. */
  /** @param {"teamwork"|"driver"|"autonomous"} mode Practice mode. @param {import("../../types").V5PracticeData} goals Game-owned field state. @returns {import("../../types").V5PracticeEvaluation} Scoring result for shared history/analysis. */
  function evaluatePracticeField(mode, goals) {
    validatePracticeGoals(goals);
    if (mode === "teamwork") return {
      kind: "scrimmage",
      scores: practiceTeamworkScores(goals),
      autonomousBonus: { red: Number(goals.autonomousBonus.red), blue: Number(goals.autonomousBonus.blue) }
    };
    if (!(["driver", "autonomous"].includes(mode))) throw new Error("Choose a supported practice mode.");
    return { kind: "skills", ...practiceSkillsScore(goals) };
  }

  /** @param {"teamwork"|"driver"|"autonomous"} mode Destination mode. @param {import("../../types").V5PracticeData} goals Current field data. @returns {import("../../types").V5PracticeData} A copied field state normalized for the destination mode. */
  function normalizePracticeGoalsForMode(mode, goals) {
    const normalized = JSON.parse(JSON.stringify(goals));
    if (mode !== "teamwork") {
      normalized.midfield.redRobots = Math.min(1, normalized.midfield.redRobots + normalized.midfield.blueRobots);
      normalized.midfield.blueRobots = 0;
      normalized.autonomousBonus = { red: false, blue: false };
    }
    return normalized;
  }

  const definition = {
    id: "override",
    name: "Override",
    program: "VEX V5",
    season: "2026-2027",
    fieldImage: "games/override/field.png",
    teamProfileProgram: "V5RC",
    brandLabel: "V5 PRACTICE MANAGER",
    disclaimer: "Created for North Union VEX V5. Not an official VEX tool.",
    manual: {
      url: "https://manuals.vex.com/v5/override/v2.1/game/",
      label: "Official rules v2.1",
      rules: { skills: { anchor: "rsc3", label: "RSC3" } }
    },
      officialStandings: {
        sourceUrl: "https://events.vex.com/robot-competitions/vex-robotics-competition/standings/skills",
        apiUrl: "https://events.vex.com/api/seasons/204/skills?post_season=0",
        country: "United States",
        countryId: 244,
        region: "Ohio",
        regionId: 47,
        groups: [{ gradeLevel: "Middle School", teamPrefix: "4810" }, { gradeLevel: "High School", teamPrefix: "6008" }],
      },
    eventName: "Override Practice",
    practiceOnly: true,
    practice: {
      modes: ["teamwork", "driver", "autonomous"],
      scrimmage: true,
      // The practice controller passes field state through this API without inspecting its shape.
      field: {
        quadrants: practiceQuadrants,
        empty: emptyPracticeGoals,
        validate: validatePracticeGoals,
        evaluate: evaluatePracticeField,
        normalizeForMode: normalizePracticeGoalsForMode
      }
    },
    scoring: {
      object: "Pin Half",
      objects: "Pin Halves",
      elements: [
        { id: "alliance", label: "Alliance-colored Pin Halves", points: 5 },
        { id: "yellow", label: "Owned yellow Pin Halves", points: 10 },
        { id: "midfield", label: "Robots in Midfield", points: 8 },
        { id: "autonomousBonus", label: "Autonomous Bonus", points: 12 }
      ]
    },
    score,
    emptyGoals,
    goalCounts,
    goalsFromCounts,
    layout: [
      {
        id: "pins",
        title: "Scored Pin Halves",
        color: "#f2a15b",
        wash: "#3e2d22",
        inputs: [
          { path: ["alliance"], label: "Alliance-colored", ariaLabel: "Alliance-colored Pin Halves", counterLabel: "Alliance-colored Pin Halves", element: 0 },
          { path: ["yellow"], label: "Owned yellow", ariaLabel: "Owned yellow Pin Halves", counterLabel: "Owned yellow Pin Halves", element: 1 }
        ]
      },
      {
        id: "midfield",
        title: "Midfield",
        color: "#8ccecb",
        wash: "#203735",
        inputs: [{ path: ["midfield"], label: "Robots", ariaLabel: "Robot", counterLabel: "Robots in Midfield", object: "Robot", objects: "Robots", element: 2, maxByMode: { teamwork: 2, driver: 1, autonomous: 1 } }]
      },
      {
        id: "autonomous",
        title: "Teamwork Autonomous Bonus",
        color: "#e8c468",
        wash: "#40391f",
        inputs: [{ path: ["autonomousBonus"], label: "Autonomous Bonus", ariaLabel: "Autonomous", counterLabel: "Autonomous Bonus", object: "bonus", objects: "bonuses", element: 3, max: 1, modes: ["teamwork"] }]
      }
    ],
    skillsTiebreak: () => [],
    csv: {
      headers: ["Alliance-colored Pin Halves", "Owned yellow Pin Halves", "Robots in Midfield", "Autonomous Bonus"],
      values: result => result.counts
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = definition;
  else (root.VexGameDefinitions = root.VexGameDefinitions || {})[definition.id] = definition;
})(globalThis);