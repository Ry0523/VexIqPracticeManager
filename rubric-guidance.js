(function (root) {
  "use strict";
  // Coaching summaries, not official rubric descriptors. Arrays run from lowest to highest rating.
  const notebook = {
    navigation: [
      "A reviewer cannot reliably find a specific piece of work.",
      "Some navigation exists, but locating evidence is still difficult.",
      "Navigation tools are present, although some entries take effort to find.",
      "A reviewer can quickly locate evidence using consistent page references and an effective contents system."
    ],
    contributors: [
      "Team identity or authorship cannot be established.",
      "The team is identified, but authorship is unclear for much of the work.",
      "Most entries can be connected to the student who contributed them.",
      "Team identity and individual contributions are consistently clear."
    ],
    season: [
      "There is no usable timeline showing work across the season.",
      "Documentation covers isolated periods, leaving substantial gaps.",
      "The timeline covers the season but has some interruptions.",
      "Regular dated records demonstrate a sustained documentation habit."
    ],
    sources: [
      "Borrowed ideas or material appear without acknowledgement.",
      "Attribution is occasional or separated from the material it relates to.",
      "Most borrowed material is acknowledged, with some omissions.",
      "Readers can identify the source of outside inspiration where it is used."
    ],
    constraints: [
      "The notebook does not establish a clear challenge or its limits.",
      "A challenge is named, but success requirements and limits are unclear.",
      "The challenge and relevant requirements are identified with limited explanation.",
      "The team explains the challenge and how requirements and constraints shape possible solutions."
    ],
    strategy: [
      "The team's approach to scoring is not recorded.",
      "A strategy is mentioned without explaining its purpose.",
      "Scoring priorities have reasons, but competing choices are not explored.",
      "The team explains priorities and the advantages it accepts or gives up."
    ],
    brainstorm: [
      "Only a chosen answer appears, with no visible exploration.",
      "A small set of ideas is listed without comparing them.",
      "Several ideas are listed, or a smaller set is meaningfully compared.",
      "Distinct possibilities are developed enough for a reader to understand their differences."
    ],
    prototypes: [
      "The record does not show prototype development.",
      "A build is shown without a clear developmental history.",
      "Multiple versions are recorded with an understandable connection.",
      "A connected progression of at least three attempts shows ongoing prototype development."
    ],
    procedures: [
      "No identifiable testing method is recorded.",
      "Testing is mentioned without explaining the measurement or procedure.",
      "The record explains what was measured and how.",
      "Measurements, procedure, and conditions are detailed enough to repeat the test."
    ],
    data: [
      "No testing outcomes are recorded.",
      "Outcomes are described broadly, without usable measurements.",
      "Either descriptive observations or numerical measurements support decisions.",
      "Both descriptive observations and numerical measurements are recorded in a useful decision-making form."
    ],
    decisions: [
      "Changes appear without a reason for making them.",
      "Choices are recorded with little supporting reasoning.",
      "Choices have reasons and evidence, but participants are unclear.",
      "The decision, decision-making process, participants, and supporting evidence are all traceable."
    ],
    mechanisms: [
      "The built mechanism is not explained visually.",
      "Images are present but do little to explain operation.",
      "Visuals identify the solution and its basic parts.",
      "Annotated visuals explain the purpose or operation of important mechanism features."
    ],
    code: [
      "Software development is not documented.",
      "Code is shown without enough explanation to understand its purpose.",
      "Software representations explain what the program is intended to do.",
      "Software documentation explains both intent and how the program evolved."
    ],
    changes: [
      "Revisions have no recorded testing basis.",
      "Tests and revisions are recorded separately, without a clear link.",
      "Revisions generally follow tests, but some connections must be inferred.",
      "The record explicitly connects revisions to the testing evidence that motivated them."
    ],
    reflection: [
      "Entries report activities without evaluating them.",
      "Reflection is limited to a final or broad summary.",
      "Evaluation appears at multiple points in the season.",
      "Regular reflection influences the team's next steps throughout the season."
    ],
    iteration: [
      "Little evidence shows repeated design cycles.",
      "Some revision is visible in one area of work.",
      "Repeated cycles are visible in one or two of building, strategy, and programming.",
      "Repeated design cycles are sustained across building, strategy, and programming."
    ]
  };
  const interview = {
    "own-work": [
      "After a relevant prompt, students cannot explain their contribution or its purpose.",
      "Students describe their work in broad terms.",
      "Students use a concrete feature or decision to explain how their work functions and why they chose it."
    ],
    development: [
      "After prompting, students cannot describe how their approach developed.",
      "Students mention attempts or difficulties without a clear example.",
      "Students connect specific attempts, setbacks, or discoveries to what they tried next."
    ],
    evidence: [
      "After prompting, students cannot explain how they checked performance.",
      "Students say they tested or improved something without concrete supporting detail.",
      "Students describe an actual test and its results, explaining what they learned or changed."
    ],
    "shared-learning": [
      "After prompting, students cannot give evidence of learning together.",
      "Students describe teamwork or helping one another generally.",
      "Students give a specific example of exchanging a skill or building shared understanding."
    ],
    "shared-decisions": [
      "After prompting, students cannot explain student participation in decisions.",
      "Students say they decided together without explaining the process.",
      "Students describe a real choice or disagreement and how students reached a decision."
    ],
    adaptation: [
      "After prompting, students cannot explain their use of outside inspiration.",
      "Students acknowledge an outside idea but give little detail about making it work for them.",
      "Students explain a specific outside idea and how they understood, adapted, or tested it for their robot."
    ]
  };
  const api = { notebook, interview };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RubricGuidance = api;
})(globalThis);
