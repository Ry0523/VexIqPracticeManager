(function (root) {
  "use strict";
  let connection;
  let queue = Promise.resolve();

  if (root.google?.script?.run) {
    let revision;
    // The event as the server last confirmed it to this page. Saves send only the differences from it.
    let base = null;
    let conflicted = false;
    let saving = 0;
    let previewing = false;
    let access = { canEdit: false, role: "viewer", team: "", email: "", domain: "", isOwner: false };
    // Waits before a retry, or until the browser reports it is back online.
    const pause = ms => new Promise(resolve => {
      const done = () => { clearTimeout(timer); root.removeEventListener?.("online", done); resolve(); };
      const timer = setTimeout(done, ms);
      root.addEventListener?.("online", done);
    });
    const call = (method, argument) => new Promise((resolve, reject) => {
      const runner = root.google.script.run.withSuccessHandler(resolve).withFailureHandler(error => reject(new Error(error.message || String(error))));
      if (argument === undefined) runner[method]();
      else runner[method](argument);
    });
    root.EventStorage = {
      shared: true,
      get conflicted() { return conflicted; },
      get previewing() { return previewing; },
      get readOnly() { return !access.canEdit; },
      get access() { return { ...access }; },
      // True when another operator has saved since this page loaded or last saved.
      async hasNewer() {
        if (previewing || conflicted || revision === undefined || saving) return false;
        const response = JSON.parse(await call("eventRevisionJson"));
        if (!response.ok || saving || revision === undefined) return false;
        return response.revision > revision;
      },
      async load() {
        await queue;
        const response = JSON.parse(await call("loadEventJson"));
        if (!response.ok) throw new Error(response.message);
        const role = ["coach", "member"].includes(response.access?.role) ? response.access.role : response.access?.canEdit && response.access?.role === undefined ? "coach" : "viewer";
        access = { canEdit: role !== "viewer", role, team: String(response.access?.team || ""), email: String(response.access?.email || ""), domain: String(response.access?.domain || ""), isOwner: response.access?.isOwner === true };
        revision = response.revision;
        base = response.event === null ? null : structuredClone(response.event);
        conflicted = false;
        previewing = false;
        return response.event === null ? undefined : response.event;
      },
      async previewMember(team) {
        await queue;
        if (previewing || !access.isOwner) throw new Error("App owner access required to preview the student view.");
        const response = JSON.parse(await call("previewMemberJson", String(team)));
        if (!response.ok) throw new Error(response.message);
        if (!response.previewing || response.access?.role !== "member" || response.access?.team !== String(team)) throw new Error("Invalid student preview response.");
        access = { canEdit: true, role: "member", team: String(response.access.team), email: String(response.access.email || ""), domain: String(response.access.domain || "") };
        revision = response.revision;
        base = structuredClone(response.event);
        conflicted = false;
        previewing = true;
        return response.event;
      },
      // Milliseconds between attempts when a save cannot reach the server; the last delay repeats until retryLimit.
      retryDelays: [2000, 4000, 8000, 15000, 30000],
      retryLimit: 5 * 60 * 1000,
      onretry: null,
      save(event) {
        const snapshot = structuredClone(event);
        if (previewing) {
          saving += 1;
          const operation = queue.then(() => {
            if (!previewing) throw new Error("Student preview ended before the change was applied.");
            base = snapshot;
          }).finally(() => { saving -= 1; });
          queue = operation.catch(() => {});
          return operation;
        }
        const requestId = root.ScoreHistory.newId();
        saving += 1;
        const operation = queue.then(async () => {
          if (!access.canEdit) throw new Error("Read-only access: ask a coach to add your account to the app's access list.");
          if (conflicted || revision === undefined) throw new Error("Reload shared data before saving.");
          // A lost connection or busy server is retried with the same request. The server recognizes a request it
          // already saved, so a save whose reply was lost is never applied twice. Once an event exists, only the
          // changes are sent, so saves from different pages merge instead of replacing each other.
          const changes = base ? root.EventChanges.diff(base, snapshot) : null;
          if (changes && !changes.length) return;
          const method = changes ? "saveChangesJson" : "saveEventJson";
          const body = JSON.stringify(changes ? { requestId, changes } : { revision, requestId, event: snapshot });
          const { retryDelays, retryLimit } = root.EventStorage;
          const started = Date.now();
          let response;
          for (let attempt = 0; !response; attempt++) {
            try { response = JSON.parse(await call(method, body)); }
            catch (error) {
              const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
              if (Date.now() - started + delay > retryLimit) throw error;
              root.EventStorage.onretry?.(error, delay);
              await pause(delay);
            }
          }
          if (!response.ok) {
            conflicted = true;
            throw new Error(response.message);
          }
          base = snapshot;
          // When someone else saved in between, the server merged both; keep the older revision so the page
          // notices the newer shared event and picks up their changes.
          if (!changes || response.previous === revision) revision = response.revision;
        }).catch(error => {
          conflicted = true;
          throw error;
        }).finally(() => { saving -= 1; });
        queue = operation.catch(() => {});
        return operation;
      },
      // Coach-only: the app's access list (stored on the Access sheet of the shared spreadsheet).
      async loadAccess() {
        if (previewing) throw new Error("Exit the student preview before managing access.");
        const response = JSON.parse(await call("loadAccessJson"));
        if (!response.ok) throw new Error(response.message);
        return response;
      },
      async saveAccess(entries) {
        if (previewing) throw new Error("Exit the student preview before managing access.");
        const response = JSON.parse(await call("saveAccessJson", JSON.stringify({ entries })));
        if (!response.ok) throw new Error(response.message);
        return response;
      }
    };
    return;
  }

  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = root.indexedDB.open("level-up-match-manager", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("events");
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Database upgrade blocked. Close other match manager tabs and reload."));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        resolve(db);
      };
    }).catch(error => { connection = undefined; throw error; });
    return connection;
  }

  // Each tab remembers the revision it loaded. A save from a tab holding an older revision is refused inside
  // the write transaction, so a second tab can never silently replace newer scores.
  let revision;
  let conflicted = false;
  const channel = typeof root.BroadcastChannel === "function" ? new root.BroadcastChannel("level-up-match-manager") : null;
  if (channel) channel.onmessage = message => {
    if (message.data?.type === "saved" && message.data.revision !== revision) root.EventStorage.onexternalchange?.();
  };

  async function load() {
    await queue;
    const db = await open();
    const stored = await new Promise((resolve, reject) => {
      const transaction = db.transaction("events", "readonly");
      const store = transaction.objectStore("events");
      const event = store.get("current");
      const saved = store.get("revision");
      transaction.oncomplete = () => resolve({ event: event.result, revision: saved.result || 0 });
      transaction.onabort = () => reject(transaction.error || new Error("Database read aborted."));
    });
    revision = stored.revision;
    conflicted = false;
    return stored.event;
  }

  function save(event) {
    const snapshot = structuredClone(event);
    const operation = queue.then(async () => {
      if (conflicted || revision === undefined) throw new Error("Reload this tab before saving.");
      const db = await open();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("events", "readwrite", { durability: "strict" });
        const store = transaction.objectStore("events");
        let stale = false;
        const current = store.get("revision");
        current.onsuccess = () => {
          if ((current.result || 0) !== revision) {
            stale = true;
            transaction.abort();
            return;
          }
          store.put(snapshot, "current");
          store.put(revision + 1, "revision");
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => {
          if (stale) conflicted = true;
          reject(stale ? new Error("Another browser tab saved newer changes to this event.") : transaction.error || new Error("Database save aborted."));
        };
      });
      revision += 1;
      channel?.postMessage({ type: "saved", revision });
    });
    queue = operation.catch(() => {});
    return operation;
  }

  root.EventStorage = { shared: false, readOnly: false, access: { canEdit: true, role: "coach", team: "", email: "", domain: "" }, get conflicted() { return conflicted; }, load, save, onexternalchange: null };
})(globalThis);
