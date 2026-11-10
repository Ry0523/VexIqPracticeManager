(function (root) {
  "use strict";
  // Coaching summaries, not official rubric descriptors. Arrays run from lowest to highest rating.
  const notebook = {
    navigation: [
      "No pagination or table of contents. Information cannot be located.",
      "Some organization is present, but locating information is difficult.",
      "Pages are numbered with a table of contents, but finding an entry takes searching.",
      "Pages are numbered, entries are ordered chronologically or by section, and a table of contents leads to specific entries."
    ],
    contributors: [
      "The team number is missing, or entries are not attributed at all.",
      "The team number appears, but entries are rarely attributed.",
      "The team number appears, and most entries are attributed to a student.",
      "The team number appears on the notebook, and all entries are signed or initialed by the student who wrote them."
    ],
    season: [
      "Entries are undated, or all appear to have been created at one time.",
      "Entries cluster in a few short periods, or large stretches of the season are missing.",
      "Dated entries span the season, showing notebooking habits with some gaps.",
      "Dated entries span the season, demonstrating a consistent habit of notebooking."
    ],
    sources: [
      "Outside work appears with no credit.",
      "A few sources are named, or credits appear only as a list, not where they were used.",
      "Most outside sources are named, though some appear without credit.",
      "Outside sources (designs, mechanisms, code, and ideas the team built on) are named where they appear."
    ],
    constraints: [
      "The problem to be solved is not defined and no criteria and constraints appear.",
      "A problem is defined without specific criteria or limits.",
      "The notebook defines a problem without explanation,and lists related criteria and constraints.",
      "The notebook defines and explains the problem along with the rules and constraints that could impact possible solutions."
    ],
    strategy: [
      "No strategy is documented.",
      "Strategy is mentioned without reasoning.",
      "The notebook describes the team’s scoring priorities with some reasoning. No tradeoffs are documented.",
      "The notebook describes the team’s scoring priorities with reasoning and tradeoffs that come with those priorities."
    ],
    brainstorm: [
      "No brainstorming appears, or a single solution appears already chosen.",
      "One or two ideas appear with no comparison.",
      "Three or more approaches are recorded without comparison, or one or two ideas appear with comparison.",
      "Several distinct approaches (coding, engineering, and/or strategy) are recorded with enough detail to see how they differ."
    ],
    prototypes: [
      "No prototyping is documented.",
      "A single build appears, with little sense of what preceded it.",
      "The notebook shows two or more attempts at a solution with a connection between the attempts.",
      "The notebook shows continuous prototyping with three or more attempts at a solution that clearly connect to one another."
    ],
    procedures: [
      "No testing is documented, or the robot was tried with no test described.",
      "Testing is mentioned without saying what was measured or how.",
      "Tests state what was measured and how.",
      "Tests state what was measured, how, and under what conditions, so the test could be repeated."
    ],
    data: [
      "No results are recorded.",
      "Results are described in general terms, without measurements.",
      "Tests record only qualitative or quantitative measurements (not both) to be used for decision making.",
      "Tests produce recorded qualitative and quantitative results in a form that can be used for data-based decision making."
    ],
    decisions: [
      "Changes appear with no indication of why.",
      "Decisions appear with little or no reasoning or evidence.",
      "Decisions are stated with reasoning and evidence. No indication is made of who was involved in the decision.",
      "The notebook states what the team decided, how the decision was made, who was part of the decision, and what evidence led to the choice."
    ],
    mechanisms: [
      "The built solution is not documented.",
      "Images appear without explanation of how or why the mechanism works.",
      "Sketches, images, or CAD show the built solution with basic labels.",
      "Sketches, images, or CAD show a built solution. Descriptive labels show how or why parts of the mechanism exist."
    ],
    code: [
      "No code documentation appears.",
      "Code appears with little or no explanation.",
      "Code is documented in any of these forms, with explanation of the intention behind the code.",
      "Pseudocode, flowcharts, annotated screenshots, or commented code show the intention behind the code and how the code was developed."
    ],
    changes: [
      "Changes appear with no testing behind them.",
      "Changes and testing both appear, but they are not connected.",
      "Changes follow from testing, though the connection is sometimes implied.",
      "Changes to the robot or code follow from recorded test results, and the notebook makes the connection explicit."
    ],
    reflection: [
      "No reflection appears, or entries record activity without evaluating it.",
      "Reflection appears only at the end, or only as a general summary.",
      "Reflections appear at more than one point in the season.",
      "The notebook shows a continuous pattern of reflection throughout the season, and reflections shape what happens next."
    ],
    iteration: [
      "The notebook shows little to no iteration.",
      "The notebook shows some iteration in one of the categories (building, strategizing, coding).",
      "The notebook shows a pattern of iteration throughout the season in one or two categories (building, strategizing, coding).",
      "The notebook shows a continuous pattern of iteration throughout the season using the Engineering Design Process for building, strategizing, and coding."
    ]
  };
  // Original paraphrases of the student-friendly rubric's four-star descriptions, ordered 1 to 4.
  const notebookStudent = {
    navigation: [
      "We have no page numbers and no table of contents. You cannot find anything.",
      "Some parts are organized, but it is hard to find what you are looking for.",
      "Our pages are numbered and we have a table of contents, but you have to hunt a little to find something.",
      "Our pages are numbered, our entries are in order (by date or by section), and our table of contents points to the exact page."
    ],
    contributors: [
      "Our team number is missing, or we never sign our entries.",
      "Our team number is there, but we hardly ever sign our entries.",
      "Our team number is there, and most entries are signed.",
      "Our team number is on the notebook, and every entry is signed or initialed by the person who wrote it."
    ],
    season: [
      "Our entries have no dates, or they all look like we wrote them at the same time.",
      "Our entries are bunched into a few short stretches. Big parts of the season are missing.",
      "Our dated entries cover the whole season, with a few gaps.",
      "Our dated entries cover the whole season. We wrote things down regularly, not once in a while."
    ],
    sources: [
      "We used other people's work without saying where it came from.",
      "We named 1 or 2 sources we used, but most are missing.",
      "We named most of the sources we used, but a few are missing.",
      "Every time we used someone else's design, mechanism, code, or idea, we said where it came from, right where we used it."
    ],
    constraints: [
      "We never said what problem we were solving, and we listed no rules or limits.",
      "We described a problem but did not say what the rules or limits were.",
      "We described the problem and listed the rules and limits, but we did not explain them.",
      "We explained the problem we were solving, and the rules and limits that could affect our solutions."
    ],
    strategy: [
      "We never wrote down a plan for scoring.",
      "We mentioned our plan but did not say why we chose it.",
      "We explained what we planned to score and gave some reasons, but did not say what we gave up.",
      "We explained what we planned to score and why, including what we gave up by choosing that plan."
    ],
    brainstorm: [
      "We did not write down any brainstorming, or our notebook starts with the answer already picked.",
      "We wrote down 1 or 2 ideas and did not compare them.",
      "We wrote down 3 or more ideas without comparing them, or 1 or 2 ideas and compared them.",
      "We wrote down many different ideas (for building, coding, or strategy) with enough detail to see how they were different from each other."
    ],
    prototypes: [
      "We did not show any builds.",
      "Only 1 build shows up. You cannot tell what we tried before it.",
      "We tried 2 or more versions, and you can see how they connect.",
      "We tried 3 or more versions of a solution, and you can see how each one led to the next."
    ],
    procedures: [
      "We did not write about testing, or we only said we tried the robot without describing a test.",
      "We said we tested something, but not what we measured or how.",
      "For each test we wrote what we measured and how. There is not enough detail for someone else to run the same test.",
      "For each test we wrote what we measured, how we measured it, and the conditions. Someone else could run the same test based on what we wrote."
    ],
    data: [
      "We did not write down any results.",
      "We described how things went in general, with no measurements.",
      "We wrote down either numbers or what we noticed, but not both.",
      "We wrote down both numbers (times, counts, measurements) and words about what we noticed, and we could use them to make decisions."
    ],
    decisions: [
      "Changes show up with no explanation of why.",
      "Our decisions show up with little or no reasoning or evidence.",
      "We wrote what we decided and the reasons and evidence behind it, but not who was involved.",
      "We wrote what we decided, how we decided it, who was part of the decision, and what evidence we used."
    ],
    mechanisms: [
      "We did not show what we built.",
      "We included pictures but did not explain how or why the mechanism works.",
      "Our sketches, photos, or CAD show what we built, with basic labels.",
      "Our sketches, photos, or CAD show what we built, with labels that explain how or why each part is there."
    ],
    code: [
      "We did not include any code documentation.",
      "Our code shows up with little or no explanation.",
      "We used one of those ways to show what we wanted the code to do.",
      "We used pseudocode, flowcharts, labeled screenshots, or comments in our code to show what we wanted the code to do and how it changed."
    ],
    changes: [
      "Our changes show up with no testing behind them.",
      "We wrote about testing and changes, but we did not connect them.",
      "Our changes came from testing, but we did not always say so.",
      "Our changes came from test results, and we said so clearly."
    ],
    reflection: [
      "We did not reflect, or we wrote what we did without saying how it went.",
      "We only reflected at the end, or only in a general summary.",
      "We reflected more than once during the season.",
      "We reflected all season, and what we learned from reflecting changed what we did next."
    ],
    iteration: [
      "You cannot really see us going through the design process again.",
      "You can see us go through it more than once in only one area.",
      "You can see us go through it again and again in one or two of those areas.",
      "You can see us go through the design process again and again all season, for building, for strategy, and for coding."
    ]
  };
  const interview = {
    "own-work": [
      "After a relevant prompt, students cannot explain their contribution or its purpose.",
      "Students describe their work in broad terms.",
      [
        "How a part of the robot, code, or strategy works.",
        "Questions land with the student who can answer - no one has to explain everything.",
        "Why the team built it that way.",
        "What they chose it over."
      ]
    ],
    development: [
      "After prompting, students cannot describe how their approach developed.",
      "Students mention attempts or difficulties without a clear example.",
      [
        "Attempts described in order.",
        "Something that did not work, and what they did next.",
        "A moment that changed their thinking - a test, a failure, a conversation."
      ]
    ],
    evidence: [
      "After prompting, students cannot explain how they checked performance.",
      "Students say they tested or improved something with no or limited concrete supporting detail.",
      [
        "Testing they did.",
        "Results - counts, times, measurements.",
        "A test that changed the design."
      ]
    ],
    "shared-learning": [
      "After prompting, students cannot give evidence of learning together.",
      "Students describe teamwork or helping one another generally.",
      [
        "One student taught another a useable skill.",
        "Students add to/extend each other's answers.",
        "A shared moment of understanding."
      ]
    ],
    "shared-decisions": [
      "After prompting, students cannot explain student participation in decisions.",
      "Students say they decided together without explaining the process.",
      [
        "How the team reached a decision",
        "A disagreement and how it was settled",
        "Decisions made by students, not for them."
      ]
    ],
    adaptation: [
      "After prompting, students cannot explain their use of outside inspiration.",
      "Students acknowledge an outside idea but give little detail about making it work for them.",
      [
        "Where an idea came from - another team, a video, a mentor (credit).",
        "What they changed to fit their robot (adapt).",
        "How they tested it on their robot (test).",
        "Why it works (understand)"
      ]
    ]
  };
  const interviewStudent = {
    "own-work": [
      "We're not sure how tot talk about our robot yet.",
      "We can say what our robot does, but it's hard to explain why we made our choices.",
      "We can each pick a part of our robot, code, or game plan and explain how it works, why we built it that way, and what we picked it over."
    ],
    development: [
      "We only talk about the finished robot, not the journey.",
      "We can name some things we tried, but our story skips around and leaves out the mistakes.",
      "We can tell what we tried first, what didn't work, and what we did next. We can share a moment that changed our thinking, like a test, a mistake, or a conversation."
    ],
    evidence: [
      "We haven't tested yet, or can't remember what happened.",
      "We can say we tested our robot, but not what we measured or what we learned.",
      "We can describe the tests we ran and share real results (counts, times, or measurements) and how those results changed our plan or told us we had a good plan."
    ],
    "shared-learning": [
      "We haven't thought about what we've learned from each other.",
      "We say we helped and learned from each other, but we don't have examples.",
      "We can each name something we learned from a teammate. We can tell about a time we figured something out together."
    ],
    "shared-decisions": [
      "We're not sure how our decisions got made.",
      "We can say what we decided, but not how we chose it.",
      "We can tell about a decision we made as a team and how we made that choice. We can say how we settled a disagreement by ourselves."
    ],
    adaptation: [
      "We use ideas without knowing where they came from.",
      "We can say where an idea came from, but not what we changed, how we tested it, or why it worked.",
      {
        text: "When we borrow an idea from another team, a video, or a coach, we can say:",
        bullets: [
          "Where it came from.",
          "What we changed to fit our robot.",
          "How we tested it.",
          "Why it works."
        ]
      }
    ]
  };
  const api = { notebook, notebookStudent, interview, interviewStudent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RubricGuidance = api;
})(globalThis);
