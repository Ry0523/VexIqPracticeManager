/** Roster identity operations that must keep references in posted event matches consistent. */
(function (root) {
  "use strict";

  /**
   * Rename/renumber a team and remap match participants, surrogates, and saved statuses.
   * @param {import("./types").Team[]} teams Current roster.
   * @param {import("./types").Match[]} matches Matches whose references must be remapped.
   * @param {string} originalId Existing team ID.
   * @param {string} rawId Requested ID; normalized to uppercase.
   * @param {string} rawName Requested display name.
   * @returns {{teams: import("./types").Team[], matches: import("./types").Match[]}} New roster and match arrays; inputs are not mutated.
   */
  function editTeam(teams, matches, originalId, rawId, rawName) {
    const id = rawId.trim().toUpperCase();
    const name = rawName.trim();
    if (!teams.some((team) => team.id === originalId)) throw new Error("Team no longer exists.");
    if (!/^[A-Z0-9-]{1,20}$/.test(id) || !name || name.length > 80)
      throw new Error("Enter a valid team number and a name of at most 80 characters.");
    if (teams.some((team) => team.id === id && team.id !== originalId))
      throw new Error(`Team ${id} already exists.`);
    return {
      teams: teams.map((team) => (team.id === originalId ? { ...team, id, name } : team)),
      matches: matches.map((match) => {
        if (!match.teams.includes(originalId)) return match;
        let result = match.result;
        if (result && id !== originalId) {
          const statuses = { ...result.statuses, [id]: result.statuses[originalId] };
          delete statuses[originalId];
          result = { ...result, statuses };
        }
        return {
          ...match,
          teams: match.teams.map((teamId) => (teamId === originalId ? id : teamId)),
          surrogate: match.surrogate === originalId ? id : match.surrogate,
          result,
        };
      }),
    };
  }

  const api = { editTeam };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TeamRoster = api;
})(globalThis);
