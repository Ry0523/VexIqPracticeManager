# Shared Google Drive deployment

The shared web app uses a Google Sheet as its authoritative event/history store. It runs **as the owner**
("Execute as me"), so visitors never need access to the Sheet itself. Who may edit is decided by the app's
access list:

| Visitor                                                                    | Access                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Coach**: the app owner, plus @nu-district.org accounts listed as coaches | Full app: scoring, setup, finals, skills, practice, notebook, interview, robot versions, backups, and **Settings > Manage access**                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Team member**: @nu-district.org accounts listed with a team              | Save new practice runs, view leaderboards, and submit notebook/interview student reviews for any team. Edit/delete only their own student reviews. Read their team's feedback plus reviews they authored; other feedback and author identities are redacted on the server. Only coach reviews count on the Cumulative leaderboard. Match control and skills scoring are hidden, and the server refuses match, finals, and skills results from members. Cannot edit/remove practice runs, open Score history, or change teams, schedules, robot versions, coach reviews, other students' reviews, or backups. |
| Anyone else signed in, including unlisted @nu-district.org accounts        | Read only: Schedule (once one exists) and Teamwork / Skills / Cumulative leaderboards, with no Print, export, Settings, or Score history. Rubric notes, reviewer names, practice notes, and robot notes are removed on the server before data reaches the browser.                                                                                                                                                                                                                                                                                                                                           |
| Not signed in                                                              | Google asks them to sign in first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Coaches manage the list from **Settings > Manage access** in the app (enter a name and email, choose Coach or
Team member and the team, then **Save**; **Remove** takes access away). The list is stored on an **Access**
tab of the spreadsheet, created automatically on the first save; coaches can also edit it there (columns
Email, Role = `coach` or `member`, Team, Updated by, Updated at, Name). Existing rows without a name display
their email until updated. Invalid rows are ignored. Changes apply the next time a person loads or saves. The
owner is always a coach and is not listed.

Only the app owner sees **Settings > Student view**. Choose a roster team to preview the live event with that
team member's redacted view and permissions. Preview edits stay in the browser and are discarded on exit; they
are never sent to the shared sheet. Listed coaches can manage access but cannot enter this preview.

**Practice / quick run separation:** members' new runs must have the student role and are excluded from all
leaderboards, including Cumulative weighting leaders. They remain available for practice history and analysis.
New coach runs are eligible; editing a student run as a coach preserves its student classification. Both save
protocols reject a student submission claiming a coach role or omitting the role. Existing runs without role
metadata remain eligible because their original submitting role was not recorded.

The server checks the visitor's account and role on every load and save; hiding the editing screens is only a
convenience. Members can add new practice runs and create, edit, or delete their own student reviews, but
cannot turn them into coach reviews or change their authorship. Ownership uses the signed-in account, not the
reviewer name. Both whole-event and change-based saves enforce these rules and preserve redacted feedback.
Existing reviews without role metadata remain coach reviews. Score data needed for practice and analysis still
reaches a member's browser, but practice-run notes and robot notes are redacted; the Score history screen
remains hidden. To change the editor domain, add a script property **EDITOR_DOMAIN** (for example
`nu-district.org`); without it, `nu-district.org` is used.

**Staying up to date:** every open page checks the sheet's revision number every 10 seconds (and whenever the
tab becomes visible again). If someone else has saved and nothing is being edited on that page, it reloads the
shared data itself, keeping its selected match and review team, and shows **Updated** with the time. If a
score, review, timer, or form is in progress, it instead shows a notice; the page updates automatically once
that work is posted or discarded, or the user can choose **Settings > Reload shared data** (which discards
unposted work). That button appears only in this case or after a refused save; otherwise there is nothing to
reload. Choosing a match is each person's own view and is not saved to the sheet. Saves from different pages
merge: a page that has not yet picked up someone else's save can still post its own score, and then updates to
show both. A save is refused only when someone else changed the same item first (see below).

> **The script must be owned and deployed by an @nu-district.org account.** Google only tells the app a
> visitor's email address when the visitor is in the same Workspace domain as the account running the script.
> If a personal Gmail account deploys it, every visitor (including staff) is read-only.

## Set up

1. Export a JSON backup from the existing local app before switching. Local IndexedDB data is not
   automatically transferred to the hosted URL.
2. Create a Google spreadsheet in the shared Drive folder (or Shared Drive). Add an empty tab named
   **EventStore**. Keep the spreadsheet private to the owner (and any co-maintainers): the app reads and
   writes it as the owner, so scorekeepers and viewers do not need Sheet access. Anyone you do share it with
   can edit or read the raw data directly, bypassing the app's read-only rules.
3. Create one standalone Apps Script project at https://script.google.com/ for this event store. Store/share
   the project in Drive as appropriate for maintenance. End users need neither the spreadsheet nor the script
   source; the web app link is enough. Use one script project for the spreadsheet: locks are scoped to that
   project.
4. From the parent workspace, run:

   ```powershell
   node .\local-match-manager\build-apps-script.js level-up
   ```

5. In the Apps Script editor, paste the generated `dist-iq/Code.gs` and `dist-iq/Models.gs` into script files
   named **Code** and **Models**. Add an HTML file named **Index** and paste `dist-iq/Index.html`. Enable
   **Show appsscript.json manifest file** in Project Settings and replace its contents with
   `dist-iq/appsscript.json`. Alternatively, push these files with clasp (see
   [Updating from VS Code with clasp](#updating-from-vs-code-with-clasp)).
6. In **Project Settings > Script properties**, add **SPREADSHEET_ID** with the ID from the spreadsheet URL
   (between `/d/` and `/edit`). This ID is configuration, not a password. Do not put credentials in the code.
7. **Deploy > New deployment > Web app**, signed in as the @nu-district.org owner. Choose **Execute as: Me**
   and **Who has access: Anyone with Google account** (the manifest's `USER_DEPLOYING` / `ANYONE`). Do not
   choose anonymous access: Google would not identify editors, so everyone would be read-only. If "Anyone with
   Google account" is not offered, the district's Workspace admin has blocked sharing web apps outside the
   domain; ask them to allow it, or choose **Anyone within nu-district.org** (then only district accounts can
   open the app at all). Deploy and share the `/exec` URL, not a Drive HTML preview.
8. The owner authorizes spreadsheet, email-address, and external-request access once, on first deployment or
   run. Visitors only sign in to Google; they see no authorization screen. An error loading or saving the
   Sheet surfaces as a message; it never falls back to private browser storage.
9. One scorekeeper imports the previously exported JSON backup from **Import backup** in the hosted app. Other
   open pages pick up the import automatically within about 10 seconds. Confirm the shared save status, then
   open **Settings > Manage access** and add the other coach and each team member. Until they are added, every
   account except the owner is read-only. Test from a listed member account (saves new practice runs only,
   reads only its own team's reviews, no Match control, Skills, or Score history), an unlisted
   @nu-district.org account, and a personal Gmail account (read-only view, no coaching notes, saves refused).

Publishing requires your Google account and cannot be completed by generating files locally. Deployment under
Shared Drive or Workspace policies may require an administrator. On source changes, rerun the build, update
the project files, and deploy a new version of the same deployment.

## Updating from VS Code with clasp

After the first setup, push changes from VS Code with [clasp](https://github.com/google/clasp) instead of
pasting files. `local-match-manager\.clasp-iq.json` links this folder to the IQ Apps Script project, and its
`rootDir` is `apps-script/dist-iq`. Only the generated files are uploaded.

One-time setup (in a VS Code terminal):

1. In https://script.google.com/home/usersettings, turn on **Google Apps Script API**.
2. Run `npx @google/clasp login` and sign in with the Google account that owns the script project.

For each update, open a terminal in VS Code (**Terminal > New Terminal**) and run:

```powershell
cd ".\local-match-manager"
npm run build:iq
npx clasp --project .\.clasp-iq.json push
npx clasp deployments
npx clasp deploy -i <deploymentId> -d "Short description of change"
```

- `build-apps-script.js level-up` regenerates `apps-script/dist-iq`. Always build before pushing; never edit
  generated files by hand.
- `clasp push` replaces the project's code with `dist-iq`, including `appsscript.json`. If it asks to
  overwrite the manifest, answer yes. Pushing updates only the editor's code and the `/dev` test URL, not the
  shared `/exec` URL.
- `clasp deployments` lists deployments. Copy the ID of the existing web app deployment (not the `@HEAD`
  entry).
- `clasp deploy -i <deploymentId>` publishes a new version to that same deployment, so the shared `/exec` URL
  stays the same. Running `clasp deploy` without `-i` creates a new deployment with a different URL.

You can instead push with clasp and publish in the browser: **Deploy > Manage deployments**, edit the existing
web app deployment, choose **Version: New version**, and **Deploy**. Users may need to refresh the page to
load the new version. Script properties (`SPREADSHEET_ID`, `FAVICON_URL`) are not affected by pushes.

### Separate VEX V5 deployment

Build the practice-only V5 target from the `local-match-manager` directory with `npm run build:v5`. It writes
`apps-script/dist-v5` and does not replace the IQ `apps-script/dist-iq` output. Create a separate Apps Script
project and spreadsheet for V5, then paste `Code.gs`, `Models.gs`, `Index.html`, and `appsscript.json` from
`dist-v5` into that project. Configure its own `SPREADSHEET_ID` and deploy it under the intended V5 owner.
Every account listed in **Settings > Manage access** has the same editing and access-management permissions;
accounts not on the list are read-only. Teamwork practice records both Alliances and all four teams; its clock
is 2:00 with a 15-second Autonomous Period. Driver and Autonomous Skills runs are solo, one-minute runs.
Analysis refreshes official World Skills standings for the configured Ohio Middle School 4810 and High School
6008 groups whenever the tab opens; the Apps Script owner must authorize the manifest's
`script.external_request` scope. Keep the two spreadsheets and web-app deployments separate.

```powershell
npm run build:v5
npx clasp --project .\.clasp-v5.json push
```

### Switching to a new season's game

Set `ACTIVE_GAME_ID` in `game.js` (see "Seasons and Games" in the main README), then build, push and deploy as
above. The first operator to open the new version starts a new session for the new game in the shared sheet.
The old roster, robot versions and schedule are cleared; score history and evaluations are kept. Export a JSON
backup before switching.

## Operation and conflict handling

Shared RPC transfers use JSON strings in both directions to preserve null fields and nested event data without
relying on Apps Script's object conversion. Update both the server files and generated HTML together.
Validation errors identify the match position and failed field; do not edit the database cells to bypass
validation.

The browser-tab icon is optional. Google serves the web app inside its own page, so the team logo embedded in
`Index.html` cannot set the tab icon; to show the NU Robotics logo, upload `nu_robotics_logo_dark.png` to a
public HTTPS host that serves the raw file and use that address below. In **Project Settings > Script
properties**, set **FAVICON_URL** to a publicly accessible HTTPS image URL whose extension identifies a
supported type (such as `.png`). Leave the property unset or remove it to use the default icon. No source
rebuild is needed when changing this property after deploying favicon support. Errors thrown by
`setFaviconUrl()` are caught and logged as warnings in Apps Script; the page still returns using its default
icon. A later browser image-download failure normally affects only the icon, not the app. This does not
guarantee a custom icon will display: verify it on the deployed page. Do not use Drive preview links or search
thumbnail URLs as direct PNG URLs. This does not change the in-app logo.

- **Saving...** clears after the server commits the snapshot. Routine saved/loaded messages are not displayed.
  **Not saved** and error warnings remain visible if the save fails.
- Each save sends only what the page changed since it last loaded or saved (`changes.js`). Under a script-wide
  lock, the server applies those changes to the latest stored event item by item: each match, finals match,
  skills attempt, notebook or interview review, and robot version; each setting (event name, team roster,
  schedule settings); and new score-history records. If another operator changed the same item since this page
  loaded it, the save is refused as a conflict naming that item, and nothing is written. Different items
  merge. The schedule selection is each person's own and never conflicts. The merged event is validated before
  it is committed. The first save of a new event sends the whole event.
- If a save cannot reach the server (Wi-Fi drop, Google hiccup, busy sheet), the page shows **Retrying
  save...** and tries again after 2, 4, 8, 15, then every 30 seconds (sooner when the device reconnects), for
  up to 5 minutes. Keep the page open; changes made meanwhile are saved in order once it reconnects. Retries
  reuse the same request, so a save whose reply was lost is never applied twice.
- After a conflict, a permission refusal, or 5 minutes without a connection, editing stops. **Export backup**
  remains available. Export pending changes, then choose **Reload shared data**. Do not import a stale pending
  backup to force it over newer active results; reconcile the intended corrections manually.
- Open pages check for newer shared data every 10 seconds, so another operator's results can take a few
  seconds to appear. Two people correcting the same match (or editing the same setting) at once still
  conflict, so agree on who scores what.
- Read-only visitors can view results but cannot print, export, open Settings or Score history, or save. Their
  page refreshes itself as new scores arrive. The UI is not a permissions boundary: the server rejects every
  save from an account outside the editor domain, and removes coaching notes before sending them data.
- Requests have unique IDs. Retrying the identical request after a committed response was lost does not create
  another revision/history entry. A failed client reloads rather than guessing whether a save committed.
- Existing score-history records cannot be changed or deleted through the server API. Teamwork and skills
  validation runs on both client and server.
- Keep independent JSON backups regularly. Sheets version history is useful but does not replace tested
  external backups.

## Sheet format

`EventStore` is an application database tab, not a human-edited score table. Cell A1 holds revision/checksum
metadata. Columns B and C hold alternating snapshot banks in text-prefixed chunks. Saves write the inactive
bank first, then commit A1; readers verify a SHA-256 checksum. A failed bank write leaves the previous
committed bank authoritative. Old extra rows are ignored based on the committed chunk count.

Do not edit, sort, clear, add formulas to, or protect individual storage cells. Use app CSV exports for
analysis in separate tabs/files. Direct spreadsheet editors can bypass application history rules or damage
storage: Drive Editor permission is trusted administrative access to the underlying data.

There is a 10-million-character snapshot limit plus Google's Apps Script execution, RPC, and Sheets quotas.
Every save transfers the event/history snapshot, so this is designed for small-team use, not high-volume
concurrent scoring. A Google API error is explicit; there is no silent offline or IndexedDB fallback in shared
mode. The local HTML app still uses IndexedDB separately.
