# VEX IQ Local Match Manager

Open `index.html` in Microsoft Edge or Chrome. No install, account, server, or internet connection is required. Keep all files in this folder together.

## Shared Google Drive App

For shared scores across computers, use the [Apps Script deployment guide](apps-script/README.md). The hosted app saves to a shared Google Sheet. Anyone signed in with a Google account can view results. Coaches (the app owner plus @nu-district.org accounts added under the coach-only **Settings > Manage access**) have full access. Team members added there can save new practice runs, view the leaderboards, and review any team's notebook or interview. They can read feedback for their team plus reviews they wrote, and edit/delete only their own student reviews; only coach reviews count toward the Cumulative leaderboard. Members do not see Match control, Skills scoring, or Score history and cannot edit practice runs. Other visitors get a read-only view (leaderboards, plus the Schedule once one exists) without coaching notes, printing, exports, settings, or Score history. Drive-folder copies of the local HTML app do **not** share their IndexedDB data. To see what a team member or read-only viewer gets without a second account, open `preview.html` from the local server (for example `http://127.0.0.1:8768/preview.html`) and choose a role and team. Pick **Sample event** (six teams with posted matches, skills, practice, and reviews for 1A and 2B) or **My local event**. The preview uses the server's own redaction and member-save rules; changes stay in that tab and are never saved. It is not part of the Apps Script build. Export a JSON backup from the local app and import it into the hosted app to migrate.

The shared version saves only what each page changed, so several people can score different matches, skills attempts, practice runs, or reviews at the same time; a save is refused only when someone else changed the same item first, never overwriting another operator's results. It retains all history and the same Cumulative leaderboard/CSV tools. Open pages pick up another operator's changes automatically within about 10 seconds; **Settings > Reload shared data** appears only when work in progress or a refused save prevents that. Google authorization, deployment, and testing with actual Drive permissions must be completed in your account. The local offline mode remains available separately.

## Run a Local Event

1. Enter each team's number and name, then choose **Add team**.
2. Choose matches per team, a starting time, and spacing. Generate the schedule.
3. Select a match and start the timer. A 3-2-1 countdown (beats 0.75 seconds apart, as on the official timer) precedes the full 60-second run, and the start sound plays as the clock begins at 1:00. Pause or reset if needed; reset is available only while the timer is stopped away from 1:00 (paused or finished) and takes effect immediately without a confirmation. The skills and practice timers follow the same rule. Driver-switch cues play at 35 and 25 seconds remaining, with an end signal at zero. Sound requires browser audio playback permission; playback failures show a warning while the visual timer continues.
4. After the field settles, enter legally scored bags in the blue and red goal stacks (L3, L2, L1, Floor) and the shared L4 top goal. Use the plus/minus controls or type a count directly. The total and goal subtotals update immediately. Set each team's result to regular, disqualified, or no show. Post the score.
5. Continue to the next unscored match. Review standings, print the schedule, or export standings as CSV.

**Full-screen match flow:** the ⛶ button beside the timer opens a full-screen view with the on-field teams and timer in large type. **Score match →** switches to the scoring form; **Post & next match →** posts the score, loads the next unscored match, and returns to the timer. If the match is already posted and unchanged, the button reads **Next match →**. On the last unscored match of the phase, it becomes **Post & exit full screen** (or **Exit full screen**) and returns you to the normal page. **← Back to timer** returns without posting. Leave the flow with **Exit full screen ×** or Escape.

**Back/Forward navigation:** each tab you open (and Score history) is added to the browser history, so the browser's or phone's Back button returns to the previous tab instead of leaving the app. The address shows the current tab (for example `#control`), and reloading reopens it. Back also closes the full-screen flow or Settings tray. Pressing Back on the first tab you opened shows a **Leave the match manager?** popup (with a warning if you have unposted score changes). **Stay** (or Escape) keeps you in the app; **Leave app** goes back. The popup appears after you've clicked or typed anywhere in the app; browsers ignore this guard on a page you haven't interacted with. Closing the tab or typing a new address is not intercepted. Unposted score edits stay in place when you switch tabs.

Notification banners stay visible until dismissed with their close button or replaced by another message. Dismissing a message does not change saved data or resolve any underlying save error.

## Teamwork Finals

Finals are built into **Match control** and support one division using [Level Up v2.1 T12-T14](https://manuals.vex.com/iq/level-up/v2.1/event/#t12). Complete and post every qualification match first, then select **Generate finals** below the qualification list. The confirmation dialog explains the pairing rules and asks for an even number of advancing teams. Only qualification-scheduled teams can advance. Adjacent qualification ranks pair together: 1 + 2 are seed 1, 3 + 4 are seed 2, etc. Each alliance gets one initial final, played lowest seed first. The Event Partner chooses the advancing count; events directly qualifying to Worlds must meet T13's minimum of five alliances per division when at least ten teams attend.

Finals appear in play order in a **Finals** list below the qualifications; select one to use the existing match calculator and synchronized 60-second timer. Finals results appear at the top of the Teamwork leaderboard, above current qualification rankings; they never change qualification averages. The highest initial finals score wins unless first place is tied. Lower-place ties favor the higher-seeded alliance.

For a first-place tie, **Generate tiebreaker series 1** schedules the tied alliances, lowest seed first. Enter each tiebreaker score and **Match Stop Time** (seconds remaining, 0-60; zero if the full minute was used). **End tiebreaker early** captures the displayed seconds when both controllers are placed on the ground; pause does not record Stop Time. Compare scores first, then higher Stop Time. If both remain tied, generate a second series for the remaining tied alliances. A remaining tie after that series favors the higher seed. Tiebreakers decide first place only; other initial-score ties use seed. The app does not declare champions until every required match is scored.

Qualification scores are locked after finals alliances are generated. **Discard unplayed finals** unlocks them only if no finals score has ever been recorded in this session. Results remain correctable/removable, but a prior series cannot change while a later tiebreaker series exists. **Void latest tiebreaker series** preserves its audit records, removes it from standings and analysis, and unlocks the preceding results; regenerate if still needed.

Before an alliance plays, **Withdraw a finals team** (below the finals list) replaces that team with the next available qualification-ranked team. Withdraw an unavailable replacement in turn if necessary. If none remain, its partner plays alone; removing the last remaining team requires Event Partner resolution outside this app. Multi-division and overall-event finals are not automated.

A finals DQ gives the entire alliance zero; an individual no-show does not erase the partner's field score. Finals and tiebreakers are saved in append-only score history with identities separate from qualification matches. They contribute to all-time Teamwork and Cumulative leaderboard scores and are included in JSON backups, shared saves, and detailed CSV exports (with phase, seed, series, and Stop Time). **Export finals CSV** exports current standings and tiebreaker results. **Print** in match control prints the selected phase's schedule. A new session clears active finals while keeping their history.

Schedule times display in 12-hour AM/PM format on screen and in print. Times after midnight include a day-offset marker, such as `12:02 AM (+1d)`. The First match input uses the browser's native time-entry format; saved start times remain in 24-hour format internally.

Posted results, score history, and registrations save in this browser's IndexedDB database. Export a JSON backup regularly. Importing replaces the current event after confirmation but merges and preserves existing score history. Unposted score edits and timer state are not included in backups or restored after a reload. Browser storage for files may change if you move the folder, switch browsers, use private browsing, or clear browser data. Export before doing any of those things. Operate an event from one tab. If another tab on this device saves changes, this tab shows a notice and refuses to save over the newer data; choose **Settings > Reload saved event** to continue with the latest scores.

## Practice / Quick Runs

All match, skills, and practice timers use audio excerpts from the user-supplied timer recording, provided with the user's confirmation of reuse rights. These are not independently authenticated official assets and do not imply endorsement. The generated `timer-sounds.js` bundles the seven `timer-*.wav` files for both local and hosted playback without external audio requests; regenerate it with `node .\local-match-manager\build-apps-script.js` if recordings change. Keep it with the local app. Clips are decoded into Web Audio buffers, leading silence is trimmed, clip edges get a 2 ms de-click ramp, the final countdown beat and the full start sound play as one seamless clip (just as in the recording), and cues are scheduled ahead rather than triggered by display polling. After audio becomes ready, the display is anchored to its output clock (using the browser's output-latency estimate where available), then advances with `performance.now()`, not the system wall clock. This keeps the display counting even if Android stops updating audio timestamps during a later run. Starting waits for audio readiness; failures warn and fall back to a monotonic visual timer. Bluetooth/speaker latency estimates vary by browser/device, so wired or built-in speakers are preferable for precise timing. The **Settings > Timer sound** checkbox controls all timers and is remembered on this device. Autonomous runs omit driver-switch cues. Fresh starts include a 2.14-second 3-2-1 countdown before the 60-second run, timed to the recording; resumed matches do not repeat the countdown. Ending a skills/practice run during preparation cancels it without recording Stop Time; starting again repeats the countdown. Timer state is not saved.

The browser-tab and home-screen icon is `nu_robotics_logo_dark.png`; keep it in the app folder. To change it, replace that file (PNG, roughly square) and rebuild the Apps Script files.

Use the **Practice** tab to record scores without creating an event or changing the active event's schedule, results, or selected match. Register the teams in the roster first; teams excluded from scheduling can still practice.

**Coach and student runs:** new runs are labeled by the submitting role. Only coach-entered practice / quick runs contribute to Teamwork, Skills, and Cumulative leaderboards, including the leaders used for weighted scores. Student runs stay in saved practice history, team analysis, trends, robot comparisons, CSV exports, and JSON backups. Coaches can correct or remove student runs, but a correction preserves the student classification; it does not promote the run to a ranked result. Students can still submit new runs only, not edit or remove saved runs. The shared server enforces student classification on both save protocols. Existing runs without role metadata keep counting as before because their original submitting role was not recorded. Local offline mode is the coach view.

Choose **Driver skills**, **Autonomous skills**, or **Teamwork** (two distinct teams). Enter optional notes and the score, then choose **Save practice run**. Practice has no result-status dropdowns: new skills runs use the entered score, and new Teamwork runs use the shared field score for both teams. Editing older runs preserves any previously recorded statuses. Each run is timestamped automatically in local time: when its timer starts, or when it is first saved if the timer was not used. Editing a run keeps its original timestamp. **Next run** starts a fresh draft. Practice attempts are unlimited and do not consume the event's three skills-attempt slots.

The optional 60-second timer cannot run alongside an event timer. For skills, enable Stop Time before starting if needed; **End run** records the seconds remaining. You can also enter a score and Stop Time manually without using the timer. Teamwork and Driver runs have a driver-switch cue. Draft scores and running timers are not restored after closing.

**Full-screen practice:** the ⛶ button beside the practice timer opens a single full-screen page with the run setup, notes, and a large timer beside the scoring calculator (stacked on phones). The bottom bar offers **Save practice run** (post only), **Discard & next run**, and **Post & next run →**, which saves the run and clears the page for the next attempt with the same run type and teams. With nothing to post, the main button reads **Next run →**. Use **Exit full screen ×**, Escape, or Back to return to the normal page.

The latest 100 saved practice runs appear below the form. By default the list shows only runs that include the team selected in the form, including Teamwork runs where it was the partner, and it updates when you change teams. Choose **Show > All teams** to see every team. Choose **Edit** to correct a run (**Cancel edit** discards the changes and returns to a new run) or **Remove practice run** to exclude it from analysis. Earlier versions and removals stay in the append-only history. Saved practice runs survive **New session (keep teams)** and are included in backups and shared saves.

## Notebook Coaching Rubric

Open **Notebook rubric** to record a dated history of coaching reviews for each team. The scoring structure follows the [VEX Engineering Notebook Rubric v2.0](https://content.vexrobotics.com/kb/global-robotics/engineering-notebook-rubric-A4-v2.0.pdf), not the separate RECF rubric. Sixteen criteria use integer ratings of 1-4 (Beginning, Developing, Proficient, Exemplary), with a maximum of **64**. Section maxima are 16 for notebook organization, 12 for Define, 16 for Develop solutions, 12 for Optimize, and 8 for Reflection and iteration. The app supplies original, abbreviated coaching prompts; consult the linked PDF for official proficiency descriptors.

Select a team to see its **current score**, its list of saved reviews (newest first), and a blank **New review** form. Enter the review date and optional reviewer, choose ratings, and record evidence or improvement notes. Overall feedback is optional. Unassessed criteria stay **Not scored**, not zero. Under each criterion, the form shows that team's earlier score and note for reference. Section subtotals and the review total update while editing.

**Each save adds a new review; earlier reviews are kept.** A review can cover the whole rubric or only a few criteria. For example, do a full review one week, then review just two criteria the next. The team's **current coach score** takes each criterion's score from the most recent coach review (by review date) that scored it. A follow-up coach review therefore updates only the criteria it covers, and criteria it leaves Not scored keep their earlier scores. Notes work the same way for the reference hints. A review must contain at least one rating or comment.

**Student reviews:** team members can submit notebook and interview reviews for any team and edit or delete only their own student reviews. Coaches can manage all reviews. Review history labels coach and student reviews separately; only coach reviews contribute to current scores and the Cumulative leaderboard. Student reviews remain student reviews even when edited by a coach. Existing reviews without role metadata are treated as coach reviews. CSV exports and JSON backups retain review roles and author identities.

Use **Edit** on a review in the team's list to correct it. **Save changes** updates that review in place, and **Cancel edit** returns to a new review. Use **Delete** (with confirmation) to remove a review. Rubrics do not affect match or skills scores. Saved reviews persist through new sessions, roster removal, and browser reloads. Renumbering a registered team moves all of its reviews to the new team number; if that number already has reviews, the histories are combined. Removed teams' saved reviews remain accessible from the rubric selector. The table at the bottom lists every reviewed team with its latest review date, number of reviews, and current score.

JSON backups include every saved review. Import merges reviews by ID: new reviews are added, and for a review edited in both places the most recently saved version wins; equal-time conflicting versions are rejected. A review deleted after a backup was made comes back if that older backup is imported. Evaluations saved before review history existed become each team's first review. **Export rubrics CSV** exports one row per review, numbered per team in date order: criterion ratings and notes, completion counts, dates, and reviewer details. Unsaved edits are not backed up or exported.

This feature is for **coaching**, not official judging. Official judging materials have confidentiality and end-of-event destruction requirements. In shared mode, feedback is stored in the same spreadsheet snapshot as scores. Coaches (and anyone with direct spreadsheet access) can read all of it; team members can read feedback for their own team plus student reviews they authored for other teams. Other feedback and author identities are removed on the server; read-only visitors receive scores without reviewer names, author identities, or notes. Authorship is checked against the signed-in account on every shared save, not the editable reviewer name. Do not enter confidential judging records or unnecessary personal information.

## Interview Coaching Rubric

Both evaluation tabs include expandable **Scoring guidance** under every criterion, with a coaching summary for each rating. These are abbreviated explanations, not official proficiency descriptors; use the PDF links for authoritative guidance. Opening guidance does not change ratings or create unsaved edits.

The **Interview** tab follows the [VEX Team Interview Rubric v2.0](https://content.vexrobotics.com/kb/global-robotics/team-interview-rubric-A4-v2.0.pdf). It has six criteria in two sections: explaining learning and working with others. Each criterion is scored **0-2**, with section maxima of 6 and an overall maximum of **12**. Ratings are 2 (Heard, with Specifics), 1 (Heard), and 0 (Not Yet Heard). Zero represents an assessed response after students have had an opportunity to address the topic; leave unassessed criteria as **Not scored** instead. The app provides abbreviated coaching prompts; consult the linked PDF for official guidance and sample questions.

Interview reviews work like notebook reviews: each save adds a dated review to the team's history, with the same student-review permissions and labeling. The current interview score uses the latest coach score for each criterion, so a follow-up coach interview can target only a few criteria. Interview and notebook evaluations are independent of match results; only coach evaluations contribute to the combined coaching ranking on the Cumulative leaderboard.

Interviews save through the same local/shared storage, survive new sessions and roster removal, and follow team renumbering. JSON backups include both evaluation types; import retains the latest saved version of each type per team and rejects equal-time conflicts. **Export interviews CSV** includes all current saved interview scores, notes, dates, reviewers, and completion counts. Unsaved changes are not exported. The same coaching-only privacy warning applies: feedback is visible to spreadsheet users, with no separate permissions for interviews.

## Browser Database

The app uses IndexedDB (`level-up-match-manager`) for asynchronous, atomic event/history saves with more capacity than local storage. **Saving...** means a transaction is still pending; it clears after the save commits. Wait for it to clear before closing. Routine saved/loaded messages are not displayed, but save errors remain visible. Writes are queued in order and snapshot the data at the time of each save. A failed save does not prevent later saves from retrying.

On first use, the previous local-storage event is validated and copied into IndexedDB. Its original local-storage copy is kept unchanged as a recovery snapshot, not maintained as a second live copy. On subsequent loads the database is authoritative. A database/read/validation failure disables editing instead of replacing existing data with an empty event. Reload to retry; do not clear storage to troubleshoot without an external backup.

IndexedDB is still browser-managed storage, not a file backup. It can be evicted or cleared and is tied to the browser profile and file location. JSON backup downloads remain necessary for durable offline recovery. No server, installation, or additional packages are needed.

The page footer shows where data is saved (this device or the shared Google Sheet), the number of current scores saved for the active game (linking to **Score history**).

## Score History and Data Analysis

Both all-time leaderboards show best-score dates, with separate Driver and Autonomous dates for skills. Dates use the viewing browser's local time zone: the entered run time for practice and the latest saved revision time for events. Stored timestamps and CSV exports remain UTC. Equal best scores show the earliest known date among surviving tied results, not necessarily the first-ever achievement if older dates are unknown. **Unknown** marks undated historical results; **--** marks no result in that mode. Correcting or removing a result can change the displayed date.

On-screen history timestamps, practice run times, analysis chart tooltips, and notebook/interview update times also use the viewing browser's local time zone. Timestamp displays include a time-zone label and AM/PM. Evaluation dates are date-only values and remain the calendar date entered; they are not shifted between time zones. Backups and CSV exports keep original UTC timestamps for data interchange.

The **Skills leaderboard** tab shows current-event skills rankings above an all-time ranking. The event section is hidden unless there is a schedule, the Skills-only event option is enabled, or active event skills results exist. All-time rankings use best Driver plus best Autonomous across saved events and practice, independently of the Cumulative leaderboard's combined coaching ranking. Equal totals share competition rank without T17 tiebreakers or qualification eligibility restrictions. The two best runs may be from different sessions. Teams without surviving skills attempts remain unranked. Event CSV export remains specific to the active event.

The **Teamwork leaderboard** tab shows current qualification rankings only while a schedule exists. Beneath them, all-time team rankings use each team's best status-adjusted Teamwork score across saved events and standalone practice, including extra appearances. Corrections replace earlier versions and removed/voided results are excluded. Equal best scores share competition rank; teams with no surviving Teamwork results remain unranked. Current roster names take precedence over historical names. These shared alliance scores are not individual robot contributions. The qualification CSV remains specific to the active event; use resolved score history exports for all-time data.

Open the **Score history** link in the page footer to review records across all sessions, then choose **Export all scores CSV** for Excel, Python, or other analysis tools. Every posted Teamwork and Driver/Autonomous skills score is retained, including earlier versions when corrected and a snapshot when removed or voided. History is append-only in the app and is not cleared by **New session (keep teams)** or by importing another event. Existing scores are added automatically on first load or import; their original posting times are unknown and left blank rather than invented. Scores deleted before this feature cannot be recovered.

The history table shows the latest 100 records; exports and JSON backups contain all records. Each record has a unique ID, a session ID, the event name, UTC recording time, and an action (`posted`, `updated`, `removed`, `voided`, or `migrated`). Names and team numbers are snapshots as recorded; later roster corrections do not rewrite history.

The CSV contains one row per team per history record (two rows for a shared Teamwork result). It includes match/round or skills mode/attempt, partner, surrogate flag, result status, raw field score, status-adjusted team score, bag counts at all five heights, recorded blue/red/unassigned goal counts, Skills Stop Time and opt-in, and the Skills-only setting. Source, Practice run ID, Run time (UTC), and Notes columns distinguish standalone practice runs from event scores. Practice uses placeholder match/attempt numbers of 1; use its run ID as the identity, not those numbers. Unknown goal breakdowns remain blank. Surrogate scores are retained for analysis even though they do not count in qualification standings. These are raw results, not ranking averages; dropped scores are not deleted.

Open the **Cumulative leaderboard** for a combined coaching ranking out of 100: **25% Skills, 25% Teamwork, 40% Notebook, 10% Interview**. Skills uses best Driver + best Autonomous divided by the highest combined skills score among teams in the selected result source. Teamwork uses the best status-adjusted shared score divided by the source's highest Teamwork score. A zero leader contributes zero for that category. Notebook uses the team's current coach score (latest coach score for each criterion) / 64; interview uses its current coach score / 12. Student reviews never contribute. Rubrics always apply regardless of the event/practice source filter. Missing categories and modes contribute zero; incomplete rubric points count without scaling to completion and are flagged. The table shows each weighted contribution, raw category scores, total, and missing/incomplete data. Equal totals share competition ranks (1, 1, 3); all teams are ranked, including teams with no data. Current roster names take precedence over historical names; teams with only saved evaluations are also included. Rankings can change when a leader improves or the source filter changes. Match corrections/removals/voids are resolved before calculating best scores. This is not official event standings or an award-selection algorithm, and shared Teamwork scores are not individual robot contributions. The standalone Teamwork and Skills leaderboards remain unchanged.

The table opens in rank order. Click any column header to sort by it; click it again to reverse. Points columns sort highest first, Team and Name sort alphabetically, and Data completeness sorts complete teams first. The Rank column always shows each team's weighted overall rank. Sorting only changes the display and resets when the page reloads.

The **Source** selector defaults to **All**. Choose **Events** or **Practice** to filter both the ranking and team-detail reports, including partner comparisons and trends. Existing history without source metadata counts as event data. History exports always include both sources regardless of this filter.

Click a team number on the Cumulative leaderboard for its detailed report, defaulting to the current robot: run counts, **Current level** (average of the latest five dated runs), **Improvement** (current level minus the preceding up to five runs), **Recent best** (highest of the latest runs), **Personal best with its earliest known local date**, and DQ counts for Teamwork, Driver, and Autonomous. Initial windows use fewer runs; improvement is unavailable without a preceding sample and can be negative. Student practice runs remain in analysis without affecting leaderboards; their chart tooltips identify them separately from coach runs. No-show, forfeit, and surrogate counts are not displayed. Status-adjusted zeros are still included, and Teamwork still includes surrogate appearances without ranking score drops. Partner comparisons and session summaries retain their high/average statistics. These are not individual robot contributions or evidence of a partner's causal effect on performance.

Trend charts show the latest 30 dated results per mode, spaced by result order rather than elapsed time. Filled dots and a thin line show individual scores; hollow dots and a thick line show the rolling five-run average. Rolling windows use the full selected history, including runs before the chart's 30-point cutoff. The recent comparison uses disjoint windows. Small samples, changing partners, and mixing events with practice can affect trends; improvement is not forced upward. Event timestamps are those of the latest saved score version, so corrections can move an event result later; they are not actual run start times. Practice uses each run's automatic timestamp, independent of when a correction is saved. Unknown timestamps are excluded from recent metrics and trends but retained in run totals, personal best, and per-session summaries. Personal-best dates show Unknown when no tied best has a known timestamp, or -- when there are no results. Each standalone practice run has its own session identity. Team numbers remain historical identities; renumbered teams are not automatically merged across history. Close team details to return focus to the ranking.

**Export resolved scores CSV**, available in the footer's **Score history** view, exports only the latest nonremoved/nonvoided results, with the same detailed columns as the audit CSV. Teamwork still has two team rows per alliance record: deduplicate by Record ID for alliance-level analysis. Skills slots retain an internal identity through team-number edits from this version onward. Older history without that identity falls back to session/team/mode/attempt; team-number changes made before this feature cannot be linked reliably. Historical team numbers remain snapshots; cross-session team summaries group by the recorded team number.

Do not sum correction or removal records in the full audit CSV as additional runs. History resolution and import use UTC recording time, with unknown migrated times first; equal times retain their input order. Keep the computer clock accurate. Importing the same modern backup again does not duplicate its history. Legacy backups without history have no stable record/session IDs, so each import creates a separate migrated session.

**Export backup** and **Import backup** are in the **Settings** menu (gear icon, top right). Export includes the active event and complete history. Import restores the active event and merges history, rejecting conflicting records with the same ID. Backup files are not limited to the old 5 MB size so the app can import its own growing history exports. Browser storage still has a finite quota: if saving fails, the app displays **Not saved**, keeps the pending score/history in memory for export, and warns before leaving. A new session or import is blocked if it cannot be saved. Export a JSON backup immediately on a storage warning. Downloaded files are your durable offline copies; there is no server or cloud backup. Export regularly and keep backups outside browser storage.

## Saved Team Roster

Use each team's **Include in schedule** checkbox before generating a schedule. Unchecked teams stay registered but are excluded from all generated teamwork matches, including surrogate appearances. At least two included teams are required; match estimates use only included teams. New and older saved teams default to included. Selections save with the roster, travel in backups/shared storage, survive team edits, and carry over to new sessions. They lock once a schedule exists; use **New session (keep teams)** to change them without rewriting an existing schedule or results. Excluded teams remain visible in standings with no appearances; history is unchanged. This option does not change skills-only access or the existing requirement for qualification participation in non-skills-only events.

Team numbers and names save automatically when you add, remove, or save an edit. Use **Edit** beside a team to change its number or name, then **Save team**. Corrections update existing match references and preserve posted scores, no-show/DQ statuses, extra appearances, and ranking tie-break draws. Editing requires a paused timer and confirmation before discarding any unposted score changes.

Use the up/down chevrons beside a team for manual ordering, or click the **Team** or **Name** table header to sort by that column. Click the same header again to reverse direction. A small arrow identifies the active sort; manual reordering or roster edits clear it. Team numbers sort naturally (for example, 2A before 10A). The resulting order saves automatically and is included in backups; the active-header indicator resets when the page reloads. Reordering does not change existing schedules, posted results, or qualification standings, and is available after scheduling too. Sorting is a one-time action; later edits and additions do not automatically re-sort the roster.

Choose **New session (keep teams)** to clear the active schedule and teamwork/skills results while retaining your roster and complete posted score history for the next event. Adding and removing teams is available before scheduling/results or after starting a new session. Existing teams can still be edited after scheduling, including corrections to their skills records.

Saved data includes the roster, event name, generated schedule, schedule settings, selected match, posted bag counts, each team's result status, and cross-session score history. Standings are recalculated from active results only. Unposted edits and timer state are not saved. The timer sound preference is stored per device, not in the event. Backups include the roster, event, and history together; importing replaces the active roster/event and merges history. There is no cloud sync: use the same browser and file location, and export a backup before moving or clearing browser data.

## Robot Versions

When a team builds a substantially different robot, click **Robots** beside the team in the roster and add a version with a name (for example "Robot 2 – claw"), the date/time it started, and optional notes. Earlier results automatically belong to the **Original robot**. The roster shows each team's current robot under its name.

- **Attribution:** each result belongs to the robot in use when it was first posted (practice runs use the entered run time). Later corrections stay with the original robot. Migrated results with unknown dates count as the original robot. Saved scores are never rewritten, so you can back-date, edit, or remove versions at any time and every view recalculates.
- **Leaderboards:** the all-time Teamwork and Skills leaderboards and the Cumulative leaderboard count only each team's current robot. Teamwork matches are judged per team: one team's new robot does not remove the match from its partner's results. The active event's qualification standings, finals, and skills event rankings are official event results and still use every posted score.
- **Removing a version:** **Remove** asks what to do with that robot's results:
  - **Count results for [previous robot]** deletes the version, as if it never existed.
  - **Abandon results** keeps the version, marked *Abandoned*. Its results (from its start until the moment you abandon it) stay in score history, the robot comparison, and CSV exports (labeled "(abandoned)"), but are excluded from every leaderboard and from current-robot stats. The previous robot becomes current again, and results recorded afterward count for it.
  - Use **Restore** to make an abandoned robot count again. Removing an abandoned robot gives its results to the previous robot.
- **Comparison:** on the Cumulative leaderboard, click a team that has versions to see a **Robot comparison** table (runs, high, and average for Teamwork, Driver, and Autonomous, plus best Driver + Autonomous for each robot). The **Robot version** selector (current robot by default, any single version, or all robots) filters the stats, trends, partners, and session tables below it.
- **Exports:** both score-history CSVs include a **Robot version** column for each team row. Robot versions travel in backups and shared storage, carry over to new sessions, follow team-number edits, and are merged by ID when importing a backup.

## Scoring and Ranking

The score-entry arrangement follows the VIQRC Hub calculator shown in [this forum reference](https://www.vexforum.com/t/what-is-the-max-score-in-vex-iq-level-up/146298/2), adapted to the local manager's dark theme. Blue/red identify goal locations, not bean-bag colors. Referees still determine which bags legally score. The calculator enforces the shared 38-bag limit, not physical stacking capacity.

New posted results store the goal breakdown as well as totals by height. Older results and backups remain compatible: their lower-level counts appear under **Unassigned goals** because colors were not recorded. They keep exactly the same score until edited. Reallocate those counts to the colored goals only when known, without counting a bag twice. The reset icon clears the draft bag counts; it does not erase a posted result until an update is posted.

Based on the official **2026-2027 Level Up manual v2.1**, checked October 28, 2026:

- Floor: 1 point per bag; L1: 3; L2: 6; L3: 12; L4: 16. At most 38 bags may be entered across all goals. The referee decides which bags legally count, including color matching, support/contact requirements, and counting a bag only once at its highest eligible level.
- The two teams share the alliance score. A DQ or no show sets only that team's qualification score to zero; its partner keeps the alliance score.
- T10 excludes 1 lowest score at 4-7 completed ranking matches, 2 at 8-11, 3 at 12-15, and 4 at 16+. Running averages apply these thresholds to completed matches, not future unplayed matches. No-show zeros cannot be excluded. If fewer eligible scores exist than the exclusion allowance, all eligible scores are excluded and no-show zeros remain.
- Extra appearances are marked `*` and excluded only for the designated extra team. An odd-sized roster has one extra appearance per round; every team still receives the requested number of counting matches.
- T11 resolves equal averages by successively removing the lowest remaining scores and comparing the resulting averages. No-show zeros stay protected during these removals, consistent with T10. A persisted random draw resolves a remaining tie. Rankings compare exact integer sums/counts rather than rounded displayed averages.
- The schedule minimizes repeat pairings heuristically; it is not the official Tournament Manager scheduling algorithm and does not guarantee rest intervals or optimal pairings. Displayed times are planned times, not enforced start times.
- Six matches per team is the default and T9's minimum at local qualifying tournaments. Smaller practice events are allowed and labeled as practice. This app does not certify a qualifying event.

## Robot Skills

Open **Skills** and select a team from the left-hand list. Driver/Autonomous mode, attempt selection, timer, and scoring are in the center; live standings appear on the right, like Match control. On narrow screens the team list scrolls horizontally and standings stack below scoring. Open the **Skills leaderboard** tab for full attempt/stop-time history and CSV export.

Use the six buttons beneath the selected team to choose Driver attempt 1-3 or Autonomous attempt 1-3. Each mode has exactly three slots per team, separate from Teamwork qualification matches (T15). Post counts with the same goal calculator. Posted slots can be corrected after confirmation, but cannot start another timed run; a fourth attempt is not available. DQs and forfeits count as used slots and contribute zero. Only void an attempt for an authorized replay or correction.

Skills runs are first-come, first-served, not part of the generated qualification schedule. A one-minute timer is included. **End run** ends the run permanently until the timer is reset, not paused. For Skills Stop Time, confirm the team's opt-in before starting; the option locks once the run starts. End run records whole seconds remaining, rounded up, only if opted in (RSC8). Zero is the default when not opted in or when time expires. The scorekeeper must confirm robots/objects are at rest and the agreed signal was given before ending a run; this app cannot detect those conditions. Stop times may also be entered manually for externally timed runs, as integers from 0 to 60.

T15 requires qualification participation unless the event is an approved Skills-Only Event. The app allows recording skills for scheduled teams before their qualification matches, but labels them **Pending qualification** and leaves them unranked until a posted non-no-show qualification result confirms participation. Select **Skills-only event** only when appropriate for your event. Turning it off asks for confirmation if recorded attempts belong to teams that are not in the qualification schedule, because those attempts would become unranked. Teams with no posted attempts have no skills rank. This is a conservative local eligibility check, not an official event certification.

The skills leaderboard follows **T17 event rankings**, in this order:

1. Best Autonomous score + best Driver score.
2. Best Autonomous score.
3. Second Autonomous score.
4. Second Driver score.
5. Sum of stop times from the best Autonomous and Driver runs.
6. Stop time from the best Autonomous run.
7. Third Autonomous score.
8. Third Driver score.
9. L4 points, then L3 points, then L2 points in the best Autonomous run.
10. The same goal-point comparisons in the best Driver run.

Equal-score runs select the greatest stop time, then L4/L3/L2 points when identifying the best run. Missing attempts contribute zero to comparisons but remain visibly unrecorded. Unresolved ties share a competition rank (1, 1, 3), not a random draw. The Event Partner must decide any authorized deciding match or shared award; this tool does not automatically grant a fourth attempt. Global rankings under T18 and multi-session league rankings under T19 are not implemented.

Posted skills attempts, goal breakdowns, statuses, opt-in decisions, stop times, and the Skills-only setting save locally and are included in event backups. Older backups without skills data import with no skills attempts. New session clears active skills results, but retains them in score history. Drafts and timer state are not saved. **Export CSV** in the skills leaderboard exports that leaderboard separately from Teamwork standings. Use **Score history > Export all scores CSV** for all attempts and revisions across sessions.

This tool covers local Teamwork qualification matches and Robot Skills. It does not control robots or field hardware, enforce on-field rules, or implement finals, leagues, awards, divisions, or official event uploads. It is not affiliated with or endorsed by VEX Robotics.

Official sources:

- https://manuals.vex.com/iq/level-up/v2.1/game/
- https://manuals.vex.com/iq/level-up/v2.1/event/
- https://manuals.vex.com/iq/level-up/v2.1/skills/
- Field reference image: https://www.vexrobotics.com/media/wysiwyg/SideView_17.png

Check official manual updates and Q&A before using results for an event.

## Seasons and Games

VEX IQ releases a new game every year. The app keeps universal tournament logic separate from the current game:

| Universal (stays each year) | Per game (`games/<id>/`) |
| --- | --- |
| Match length and driver-switch window (`TIMING` in `core.js`), schedules, ranking drops and tiebreak order, finals seeding, skills attempts, rubrics, score history, storage, exports | Name, season, manual links and rule numbers, scoring elements and points, object cap, scoring-screen layout and goal diagrams, skills score tiebreak, game-specific CSV columns |

The active game is a code flag, not a menu option. In `game.js`:

```js
const ACTIVE_GAME_ID = "level-up";
```

Every score history record, event, notebook evaluation and interview is tagged with its game. Saved data without a tag belongs to `LEGACY_GAME_ID` (Level Up). Screens, leaderboards, analysis and CSV exports cover only the active game. Older seasons stay in the database and in JSON backups.

When the flag changes, the next load starts a fresh session for the new game, with a notice explaining what happened. Each season has new teams, so the roster, robot versions, schedule, finals and skills slots are cleared; add the new season's teams as usual. All score history and notebook/interview evaluations are kept (tagged with their game) for analysis and stay in JSON backups. Export a backup before switching if you want the old roster and robot versions on file.

To read an older season's CSVs or leaderboards, export a JSON backup first. Then temporarily set `ACTIVE_GAME_ID` back to the old game.

### Adding next year's game

1. Copy the `games/level-up/` folder to `games/<new-id>/`. Each game keeps everything it owns in its folder: `definition.js` (rules and scoring), `styles.css` (goal diagrams) and `field.png` (the header picture). Replace the picture and update the definition:
   - `id`, `name`, `program`, `season`, `fieldImage` (`games/<new-id>/field.png`)
   - `manual`: the URL, label, and rule anchors for `schedule`, `finals`, and `skills`
   - `scoring`: object names, `maxObjects`, and `elements` (label and points)
   - `score`, `emptyGoals`, `goalCounts`, `goalsFromCounts`, `layout`, `skillsTiebreak`, `csv`
2. Register the new game in three places:
   - Add `require("./games/<new-id>/definition.js")` to the list in `game.js`.
   - Add a `<script src="games/<new-id>/definition.js" defer>` tag and a `<link rel="stylesheet" href="games/<new-id>/styles.css">` to `index.html`, before `game.js` and `styles.css`.
   - Add `games/<new-id>/definition.js` to `gameFiles` in `build-apps-script.js` (its stylesheet and active field picture are inlined automatically).
3. Set `ACTIVE_GAME_ID` to the new id. Leave `LEGACY_GAME_ID` unchanged.
4. **Keep the old game files registered.** Saved history that refers to an unregistered game is rejected on load to protect the data.
5. Run the tests, then rebuild the Apps Script files.

## Tests

With Node.js installed, run from the parent workspace:

```powershell
node --test .\local-match-manager\core.test.js .\local-match-manager\history.test.js .\local-match-manager\practice.test.js .\local-match-manager\rubric.test.js .\local-match-manager\shared.test.js .\local-match-manager\timer-audio.test.js .\local-match-manager\finals.test.js .\local-match-manager\game.test.js
```

Or, from the `local-match-manager` folder, run `npm test` for the same unit tests.

Browser tests drive the real app in Microsoft Edge: posting and reloading scores, two-tab save protection, unsaved-draft warnings, Back-button navigation, text escaping, rubric accessibility, interview review history (follow-up review, edit and delete), shared-app roles (viewer, team member, and the coach access list), the match timer (countdown, driver-switch window, pause, reset), the full-screen match flow, and driver/autonomous skills runs including early stop times. Each test starts with an empty browser database; timer tests disable audio and use a simulated clock, so a 60-second run takes moments. From the `local-match-manager` folder, run `npm install` once, then:

```powershell
npm run test:browser
```

Set `PLAYWRIGHT_CHANNEL=chrome` to use Google Chrome instead of Edge.
