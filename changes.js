(function (root) {
  "use strict";
  // Change-based shared saves. A page sends only what it changed since it last loaded or saved; the server applies
  // those changes to the latest stored event. Each match, skills attempt, review, and robot version merges on its own,
  // so two people only conflict when they change the same item (or the same setting) at the same time.

  const stable = value => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    return JSON.stringify(value === undefined ? null : value);
  };

  // Collections merged per item. Ordered collections also carry their item order (a new schedule or finals bracket).
  const COLLECTIONS = {
    matches: { id: match => String(match.id), ordered: true },
    finals: { id: match => String(match.id), ordered: true },
    skills: { id: entry => `${entry.team}:${entry.mode}:${entry.attempt}` },
    rubrics: { id: entry => entry.id },
    interviews: { id: entry => entry.id },
    robots: { id: robot => robot.id }
  };
  // Each person's own selection: the latest save wins and never conflicts.
  const PERSONAL = new Set(["selected", "selectedPhase"]);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const validKey = key => typeof key === "string" && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key) && !["constructor", "prototype"].includes(key);

  function diff(base, next) {
    const changes = [];
    const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
    for (const key of keys) {
      if (key === "history") {
        const known = new Set((base.history || []).map(record => record.id));
        const records = (next.history || []).filter(record => !known.has(record.id));
        if (records.length) changes.push({ type: "history", records });
      } else if (own(COLLECTIONS, key)) {
        const { id, ordered } = COLLECTIONS[key];
        const before = new Map((base[key] || []).map(item => [id(item), item]));
        const after = new Map((next[key] || []).map(item => [id(item), item]));
        for (const itemId of new Set([...before.keys(), ...after.keys()])) {
          const from = before.get(itemId) ?? null;
          const to = after.get(itemId) ?? null;
          if (stable(from) !== stable(to)) changes.push({ type: "item", key, id: itemId, before: from, after: to });
        }
        const order = list => (list || []).map(id);
        if (ordered && stable(order(base[key])) !== stable(order(next[key]))) changes.push({ type: "order", key, before: order(base[key]), after: order(next[key]) });
      } else if (stable(base[key]) !== stable(next[key])) {
        changes.push({ type: "value", key, before: base[key] ?? null, after: next[key] ?? null });
      }
    }
    return changes;
  }

  function label(change) {
    if (change.type === "order") return change.key === "finals" ? "the finals bracket" : "the schedule";
    if (change.type === "value") return { teams: "the team roster", name: "the event name", rounds: "the schedule", start: "the schedule", interval: "the schedule", sessionId: "the session", finalsWithdrawn: "finals withdrawals", skillsOnly: "the event type", game: "the game" }[change.key] || `the ${change.key} setting`;
    if (change.type === "history") return "score history";
    const item = change.after || change.before;
    if (change.key === "matches") return `match Q${item.id}`;
    if (change.key === "finals") return "a finals match";
    if (change.key === "skills") return `${item.team}'s ${item.mode} skills attempt ${item.attempt}`;
    if (change.key === "rubrics") return `a ${item.team.id} notebook review`;
    if (change.key === "interviews") return `a ${item.team.id} interview review`;
    return `a ${item.team} robot version`;
  }

  // Returns the merged event and the changes that could not be applied because someone else changed the same thing.
  // A change already present in the stored event (a retried save) is accepted without applying it twice.
  function apply(stored, changes) {
    const event = { ...stored };
    const conflicts = [];
    const swap = (current, change) => {
      if (stable(current) === stable(change.after)) return "same";
      return stable(current) === stable(change.before) ? "apply" : "conflict";
    };
    const items = {};
    const itemsOf = key => {
      if (!items[key]) items[key] = new Map((stored[key] || []).map(item => [COLLECTIONS[key].id(item), item]));
      return items[key];
    };
    for (const change of changes) {
      if (!change || typeof change !== "object") throw new Error("Invalid shared change.");
      if (change.type !== "history" && (!validKey(change.key) || change.key === "history")) throw new Error("Invalid shared change.");
      if (change.type === "value") {
        if (PERSONAL.has(change.key)) { event[change.key] = change.after; continue; }
        const result = swap(stored[change.key] ?? null, change);
        if (result === "apply") event[change.key] = change.after;
        else if (result === "conflict") conflicts.push(label(change));
      } else if (change.type === "item") {
        if (!own(COLLECTIONS, change.key) || typeof change.id !== "string") throw new Error("Invalid shared change.");
        const map = itemsOf(change.key);
        const result = swap(map.get(change.id) ?? null, change);
        if (result === "conflict") conflicts.push(label(change));
        else if (change.after === null) map.delete(change.id);
        else map.set(change.id, change.after);
      } else if (change.type === "history") {
        if (!Array.isArray(change.records)) throw new Error("Invalid shared change.");
        const known = new Map((event.history || []).map(record => [record.id, record]));
        const added = [];
        for (const record of change.records) {
          if (!known.has(record.id)) { added.push(record); known.set(record.id, record); }
          else if (stable(known.get(record.id)) !== stable(record)) conflicts.push(label(change));
        }
        event.history = [...(event.history || []), ...added];
      } else if (change.type === "order") {
        if (!own(COLLECTIONS, change.key) || !COLLECTIONS[change.key].ordered || !Array.isArray(change.after) || !Array.isArray(change.before)) throw new Error("Invalid shared change.");
        itemsOf(change.key);
      } else throw new Error("Invalid shared change.");
    }
    for (const key of Object.keys(items)) {
      const map = items[key];
      const order = changes.find(change => change.type === "order" && change.key === key);
      if (order) {
        const current = (stored[key] || []).map(COLLECTIONS[key].id);
        const result = swap(current, order);
        if (result === "conflict" || order.after.some(id => !map.has(id)) || map.size !== order.after.length) { conflicts.push(label(order)); continue; }
        event[key] = order.after.map(id => map.get(id));
      } else {
        const kept = (stored[key] || []).map(COLLECTIONS[key].id).filter(id => map.has(id));
        const added = [...map.keys()].filter(id => !kept.includes(id));
        event[key] = [...kept, ...added].map(id => map.get(id));
      }
    }
    // A selection that no longer exists after merging falls back to none.
    const phase = event.selectedPhase === "finals" ? event.finals : event.matches;
    if (event.selected !== null && event.selected !== undefined && !(phase || []).some(match => match.id === event.selected)) event.selected = null;
    return { event, conflicts: [...new Set(conflicts)] };
  }

  const api = { diff, apply, label, stable, PERSONAL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EventChanges = api;
})(globalThis);
