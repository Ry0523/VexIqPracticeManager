/** Browser/Node facade for shared scoring, schedule, and roster rule modules. */
(function (root) {
  "use strict";
  const modules = typeof module !== "undefined" && module.exports
    ? [require("./scoring.js"), require("./scheduling.js"), require("./teams.js")]
    : [root.MatchScoring, root.MatchScheduling, root.TeamRoster];
  const api = Object.assign({}, ...modules);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EventRules = api;
})(globalThis);