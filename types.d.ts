export type TeamId = string;
export type TeamResultStatus = "ok" | "dq" | "absent";
export type SkillsResultStatus = "ok" | "dq" | "forfeit";
export type PracticeMode = "teamwork" | "driver" | "autonomous";

export interface TimingSettings {
  matchMs: number;
  driverSwitch: { openMs: number; closeMs: number } | null;
  teamworkPracticeMs?: number;
  autonomousPeriodMs?: number;
  driverPeriodMs?: number;
}

export interface Team {
  id: TeamId;
  name: string;
  draw: number;
  includeInSchedule?: boolean;
}

export interface MatchResult {
  counts: number[];
  goals?: unknown;
  statuses: Record<TeamId, TeamResultStatus>;
  stopTime?: number;
}

export interface Match {
  id: number;
  round: number;
  teams: TeamId[];
  surrogate: TeamId | null;
  result: MatchResult | null;
  phase?: "qualification" | "finals";
  seed?: number;
}

export interface FinalsMatch extends Match {
  phase: "finals";
  seed: number;
  result: (MatchResult & { stopTime: number }) | null;
}

export interface FinalsOutcomeRow {
  seed: number;
  teams: TeamId[];
  score: number | null;
  rank: number | null;
  matches: FinalsMatch[];
}

export interface FinalsOutcome {
  rows: FinalsOutcomeRow[];
  complete: boolean;
  pending: number[];
  nextRound: number | null;
  champion: number | null;
}

export interface StandingsRow extends Team {
  played: number;
  excluded: number[];
  kept: number[];
  tiebreakOrder: number[];
  sum: number;
  average: number | null;
  entries: Array<{ match: number; score: number; protected: boolean }>;
}

export interface SkillsAttempt {
  team: TeamId;
  mode: "driver" | "autonomous";
  attempt: 1 | 2 | 3;
  counts: number[];
  goals?: unknown;
  status: SkillsResultStatus;
  optIn: boolean;
  stopTime: number;
  resultId?: string;
}

export interface SkillsStandingAttempt extends SkillsAttempt {
  value: number;
  stop: number;
  levels: number[];
  key: number[];
}

export interface SkillsStandingRow extends Team {
  eligible: boolean;
  entered: boolean;
  modes: Record<"driver" | "autonomous", SkillsStandingAttempt[]>;
  bestAuto: number;
  bestDriver: number;
  total: number;
  autoStop: number;
  driverStop: number;
  key: number[];
  rank: number | null;
}

export interface RobotVersion {
  id: string;
  team: TeamId;
  name: string;
  startedAt: string;
  notes: string;
  abandonedAt?: string;
}

export interface ReviewEvaluation {
  id: string;
  version: string;
  team: Pick<Team, "id" | "name">;
  game?: string;
  evaluatedOn: string;
  createdAt: string;
  updatedAt: string;
  reviewer: string;
  overallNotes: string;
  scores: Record<string, number | null>;
  notes: Record<string, string>;
  reviewRole?: "coach" | "member";
  authorEmail?: string;
}

export interface RubricCriterion {
  id: string;
  section: string;
  title: string;
  prompt: string;
  questions?: string[];
}

export interface ReviewInput {
  evaluatedOn: string;
  reviewer: string;
  overallNotes: string;
  scores: Record<string, number | null>;
  notes: Record<string, string>;
  reviewRole?: "coach" | "member";
  authorEmail?: string;
}

export interface ReviewSummary {
  total: number;
  scored: number;
  maximum: number;
}

export interface CurrentReview extends ReviewSummary {
  criteria: Record<
    string,
    { score: number | null; scoredOn: string | null; note: string; notedOn: string | null }
  >;
  reviews: number;
  latest: ReviewEvaluation;
}

export interface RubricModel {
  version: string;
  criteria: RubricCriterion[];
  minimum: number;
  maximum: number;
  validate(evaluations: ReviewEvaluation[]): ReviewEvaluation[];
  summary(entry: ReviewEvaluation): ReviewSummary;
  reviews(evaluations: ReviewEvaluation[], teamId: TeamId): ReviewEvaluation[];
  current(evaluations: ReviewEvaluation[], teamId: TeamId, excludeId?: string | null): CurrentReview | null;
  save(
    evaluations: ReviewEvaluation[],
    team: Pick<Team, "id" | "name">,
    input: ReviewInput,
    reviewId?: string | null,
    gameId?: string,
  ): ReviewEvaluation[];
  remove(evaluations: ReviewEvaluation[], reviewId: string): ReviewEvaluation[];
  rename(
    evaluations: ReviewEvaluation[],
    previousId: TeamId,
    team: Pick<Team, "id" | "name">,
  ): ReviewEvaluation[];
  merge(existing: ReviewEvaluation[], incoming: ReviewEvaluation[]): ReviewEvaluation[];
  csv(evaluations: ReviewEvaluation[]): string;
}

export interface ReviewUIController {
  /** Renders the selected team and review form/history. */
  render(): void;
  /** Clears the active team/review selection and resets the form. */
  reset(): void;
  /** Reports whether the review form has unsaved edits. */
  isDirty(): boolean;
}

export interface NotebookRubricApi extends RubricModel {
  Interview: RubricModel;
  combinedRanking(
    records: ScoreHistoryRecord[],
    teams?: Team[],
    notebooks?: ReviewEvaluation[],
    interviews?: ReviewEvaluation[],
    include?: (record: ScoreHistoryRecord, teamId: TeamId) => boolean,
  ): CombinedRankingRow[];
}

export interface CombinedRankingRow {
  id: TeamId;
  name: string;
  skills: number;
  teamwork: number;
  notebook: number;
  interview: number;
  skillsPoints: number;
  teamworkPoints: number;
  notebookPoints: number;
  interviewPoints: number;
  total: number;
  missing: string[];
  rank: number;
}

export interface PracticeRunInput<GameData = unknown> {
  mode: PracticeMode;
  teams: TeamId[];
  goals: unknown;
  gameData?: GameData;
  scrimmage?: boolean;
  redTeams?: TeamId[];
  blueTeams?: TeamId[];
  occurredAt: string;
  notes: string;
  status: SkillsResultStatus;
  optIn: boolean;
  stopTime: number;
  runRole?: "coach" | "member";
}

export interface HistoryContext {
  sessionId: string;
  name: string;
  skillsOnly: boolean;
  game?: string;
  teams: Team[];
}

export type HistoryAction = "posted" | "updated" | "promoted" | "removed" | "voided" | "migrated";
export type HistoryKind = "teamwork" | "skills" | "scrimmage";

export interface ScoreHistoryRecord<Value = unknown> {
  id: string;
  sessionId: string;
  eventName: string;
  recordedAt: string | null;
  action: HistoryAction;
  kind: HistoryKind;
  skillsOnly: boolean;
  game: string;
  teams: Team[];
  value: Value;
  source?: "event" | "practice";
  runId?: string;
  occurredAt?: string;
  notes?: string;
  runRole?: "coach" | "member";
}

export interface NumericStatistics {
  count: number;
  average: number | null;
  median: number | null;
  best: number | null;
  deviation: number | null;
}

export interface HistorySummaryRow extends NumericStatistics {
  scope: string;
  type: string;
}

export interface HistoryAnalysis {
  resolved: ScoreHistoryRecord[];
  rows: HistorySummaryRow[];
}

export interface HistoryAnalysisEntry {
  recordId: string;
  sessionId: string;
  eventName: string;
  recordedAt: string | null;
  label: string;
  status: TeamResultStatus | SkillsResultStatus;
  score: number;
  fieldScore?: number;
  opponentScore?: number;
  scoreDifferential?: number;
  outcome?: "win" | "tie" | "loss";
  wp?: number;
  ap?: number;
  partner?: TeamId;
  surrogate?: boolean;
}

export interface HistoryTrendPoint extends HistoryAnalysisEntry {
  rollingAverage: number | null;
  rollingCount: number;
}

export interface TeamModeAnalysis extends NumericStatistics {
  entries: HistoryAnalysisEntry[];
  dq: number;
  absent: number;
  forfeit: number;
  surrogate: number;
  timed: HistoryAnalysisEntry[];
  unknownDates: number;
  recentCount: number;
  previousCount: number;
  recentAverage: number | null;
  previousAverage: number | null;
  change: number | null;
  recentBest: number | null;
  bestDate: string;
  rolling: HistoryTrendPoint[];
}

export interface TeamScrimmageAnalysis {
  matches: number;
  wins: number;
  ties: number;
  losses: number;
  wp: number;
  ap: number;
  sp: number;
  scoreFor: NumericStatistics;
  scoreAgainst: NumericStatistics;
  scoreDifferential: NumericStatistics;
  opr: number | null;
  dpr: number | null;
  ccwm: number | null;
  entries: HistoryAnalysisEntry[];
}

export interface TeamPartnerAnalysis extends TeamModeAnalysis {
  id: TeamId;
  name: string;
  fieldAverage: number | null;
  fieldBest: number | null;
}

export interface TeamAnalysis {
  modes: Record<PracticeMode, TeamModeAnalysis>;
  scrimmage: TeamScrimmageAnalysis;
  partners: TeamPartnerAnalysis[];
}

export interface TeamworkRankingRow extends Pick<Team, "id" | "name"> {
  best: number | null;
  bestDate: string;
  played: number;
  rank: number | null;
}

export interface SkillsRankingRow extends Pick<Team, "id" | "name"> {
  driver: number;
  autonomous: number;
  driverDate: string;
  autonomousDate: string;
  total: number;
  entered: boolean;
  rank: number | null;
}

export interface EventState {
  version: 1;
  game: string;
  sessionId: string;
  name: string;
  teams: Team[];
  matches: Match[];
  finals: FinalsMatch[];
  finalsWithdrawn: TeamId[];
  selectedPhase: "qualification" | "finals";
  selected: number | null;
  skills: SkillsAttempt[];
  skillsOnly: boolean;
  history: ScoreHistoryRecord[];
  rubrics: ReviewEvaluation[];
  interviews: ReviewEvaluation[];
  robots: RobotVersion[];
  rounds: number;
  start: string;
  interval: number;
}

export type EventCollectionKey = "matches" | "finals" | "skills" | "rubrics" | "interviews" | "robots";

export type EventChange =
  | { type: "value"; key: string; before: unknown; after: unknown }
  | { type: "item"; key: EventCollectionKey; id: string; before: unknown; after: unknown }
  | { type: "order"; key: "matches" | "finals"; before: string[]; after: string[] }
  | { type: "history"; records: ScoreHistoryRecord[] };

export interface EventMergeResult {
  event: EventState;
  conflicts: string[];
}

export interface EventStorageAccess {
  canEdit: boolean;
  role: "coach" | "member" | "viewer";
  team: string;
  email: string;
  domain: string;
  isOwner?: boolean;
}

export interface AccessEntry {
  name: string;
  email: string;
  role: "coach" | "member";
  team: TeamId | "";
}

export interface AccessListResponse {
  ok: boolean;
  owner: string;
  domain: string;
  entries: AccessEntry[];
}

export interface AccessUIController {
  /** Loads and displays the shared access list when the current user may manage it. */
  open(): Promise<void>;
  /** Renders the loaded access list and form controls. */
  render(): void;
}

export interface EventStorageApi {
  shared: boolean;
  readonly conflicted: boolean;
  readonly previewing?: boolean;
  readonly readOnly: boolean;
  access: EventStorageAccess;
  onretry?: ((error: Error, delay: number) => void) | null;
  onexternalchange?: (() => void) | null;
  hasNewer?(): Promise<boolean>;
  load(): Promise<EventState | undefined>;
  loadOfficialSkillsStandings?(): Promise<unknown>;
  previewMember?(teamId: TeamId): Promise<EventState>;
  save(event: EventState): Promise<void>;
  loadAccess?(): Promise<AccessListResponse>;
  saveAccess?(entries: AccessEntry[]): Promise<AccessListResponse>;
}

export interface LevelUpGoals {
  blue: number[];
  red: number[];
  unassigned: number[];
  top: number;
}

export interface OverrideGoals {
  alliance: number;
  yellow: number;
  midfield: number;
  autonomousBonus: number;
}

export interface PracticeField<GameData = unknown, Evaluation = unknown> {
  /** Field schema exposed to a game-specific practice view, if needed. */
  quadrants?: unknown[];
  /** Creates a fresh game-owned practice payload. */
  empty(): GameData;
  /** Validates and returns the game-owned practice payload. */
  validate(data: GameData): GameData | void;
  /** Calculates a Skills or scrimmage result from the opaque payload. */
  evaluate(mode: PracticeMode, data: GameData): Evaluation;
  /** Reconciles mode-specific state when switching practice modes. */
  normalizeForMode?(mode: PracticeMode, data: GameData): GameData;
}

export interface PracticeView<GameData = unknown, Evaluation = unknown> {
  /** Renders the game-specific practice controls. */
  render(context: { mode: PracticeMode; data: GameData }): void;
  /** Reads the current controls into the game-owned payload. */
  read(mode: PracticeMode): GameData;
  /** Updates game-specific controls from the latest evaluation. */
  update(context: { mode: PracticeMode; data: GameData; result: Evaluation | null }): void;
  /** Handles custom field-control clicks and reports whether it consumed the event. */
  handleClick(event: MouseEvent): boolean;
}

export interface PracticeUIController {
  /** Renders the active practice form and run history. */
  render(): void;
  /** Clears the active practice draft and timer. */
  reset(): void;
  /** Exits the fullscreen practice flow. */
  exitFlow(): void;
  /** Reports whether the practice draft differs from its saved baseline. */
  isDirty(): boolean;
  /** Reports whether a practice timer is currently running. */
  isRunning(): boolean;
}

export interface SkillsUIController {
  /** Renders the selected Skills team, attempt, and standings. */
  render(): void;
  /** Resets the selected attempt draft and timer. */
  reset(): void;
  /** Discards unposted edits for the selected attempt. */
  discard(): void;
  /** Reports whether the attempt draft has unsaved edits or is paused. */
  isDirty(): boolean;
  /** Reports whether the Skills timer is running. */
  isRunning(): boolean;
}

export interface TimerAudioApi {
  /** Schedules countdown/game cues and resolves with the run deadline in milliseconds. */
  start(remaining: number, fresh: boolean, driver?: boolean): Promise<number | null>;
  /** Returns the current monotonic timer value in milliseconds. */
  now(): number;
  /** Cancels pending audio and clears the active deadline. */
  stop(): void;
  /** Finishes the current run and plays the end cue. */
  finish(): void;
  /** Maps pre-start time to the displayed countdown number. */
  countdownNumber(msBeforeStart: number): number;
  readonly COUNTDOWN_MS: number;
  /** Whether audio initialization is currently pending. */
  isStarting(): boolean;
}

export interface GameManualRule {
  /** Fragment identifier in the official manual. */
  anchor: string;
  /** Label displayed for the rule link. */
  label: string;
}

export interface GameManual {
  /** Official game-manual URL. */
  url: string;
  /** Human-readable manual/version label. */
  label: string;
  /** Rule links exposed by the app, keyed by their shared HTML data attribute. */
  rules: Record<string, GameManualRule>;
}

export interface GameOfficialStandingGroup {
  /** Grade cohort used by the standings request. */
  gradeLevel: string;
  /** Team-number prefix used to scope the team's standings lookup. */
  teamPrefix: string;
}

export interface GameOfficialStandings {
  /** Public standings page used as the display/source link. */
  sourceUrl: string;
  /** Data endpoint refreshed by the shared app. */
  apiUrl: string;
  country: string;
  countryId: number;
  region: string;
  regionId: number;
  /** Grade/team groups included in this game's standings snapshot. */
  groups: GameOfficialStandingGroup[];
}

export interface GameScoringElement {
  /** Stable element key used by layouts and exports. */
  id: string;
  /** Display name for the scored object/category. */
  label: string;
  /** Points awarded per count. */
  points: number;
}

export interface GameScoring {
  /** Singular object noun used in stepper controls. */
  object: string;
  /** Plural object noun used in count displays. */
  objects: string;
  /** Optional shared maximum count across all inputs. */
  maxObjects?: number;
  /** Count order and point values consumed by shared calculator logic. */
  elements: GameScoringElement[];
}

export interface GameLayoutInput {
  /** Path into the game's goal object for this counter. */
  path: Array<string | number>;
  /** Visible label. */
  label: string;
  /** Index into `scoring.elements`. */
  element: number;
  ariaLabel?: string;
  counterLabel?: string;
  object?: string;
  objects?: string;
  max?: number;
  maxByMode?: Partial<Record<PracticeMode, number>>;
  modes?: PracticeMode[];
}

export interface GameLayoutGroup<GameGoals = unknown> {
  /** Stable group key used for styling. */
  id: string;
  /** Accessible group title. */
  title: string;
  /** CSS color tokens consumed by the shared calculator. */
  color: string;
  wash: string;
  /** Counters rendered within this group. */
  inputs: GameLayoutInput[];
  /** Optional game-owned diagram markup. */
  diagram?: string;
  /** Optional explanation for legacy or special goal data. */
  note?: string;
  /** Controls whether this group is shown for the current goal draft. */
  optional?: (goals: GameGoals) => boolean;
}

export interface GameCsvResult<GameGoals = unknown> {
  counts: number[];
  goals?: GameGoals;
}

export interface GameCsv<GameGoals = unknown> {
  /** Ordered column headings. */
  headers: string[];
  /** Projects a saved result into one CSV row. */
  values(result: GameCsvResult<GameGoals>): Array<number | boolean | string>;
}

/**
 * Contract for a registered game. `game.js` checks the required fields; the
 * optional fields customize page labels, official standings, timing, and practice.
 */
export interface GameDefinition<GameGoals = unknown, GamePracticeData = unknown, GameEvaluation = unknown> {
  /** Stable game ID persisted in events and score history; never recycle it. */
  id: string;
  /** User-facing game name. */
  name: string;
  /** Program name, such as VEX IQ or VEX V5. */
  program: string;
  /** Season/version label shown in the application. */
  season: string;
  /** Manual links shown by the app. */
  manual: GameManual;
  /** Score-entry labels, count limits, and point weights. */
  scoring: GameScoring;
  /** Calculates points from counts in `scoring.elements` order. */
  score(counts: number[]): number;
  /** Creates a fresh game-owned goal object. */
  emptyGoals(): GameGoals;
  /** Validates and aggregates game goals into scoring-element order. */
  goalCounts(goals: GameGoals): number[];
  /** Reconstructs game-owned goals from aggregate counts, including legacy data. */
  goalsFromCounts(counts: number[]): GameGoals;
  /** Describes the shared calculator groups and input-to-goal paths. */
  layout: GameLayoutGroup<GameGoals>[];
  /** Game-specific suffix for Skills ranking tie-breaks. */
  skillsTiebreak(counts: number[]): number[];
  /** Column names and result-to-row mapping for CSV export. */
  csv: GameCsv<GameGoals>;
  /** Optional field image path; the Apps Script builder embeds it in the bundle. */
  fieldImage?: string;
  teamProfileProgram?: string;
  brandLabel?: string;
  disclaimer?: string;
  eventName?: string;
  practiceOnly?: boolean;
  /** Optional public standings source and team cohort configuration. */
  officialStandings?: GameOfficialStandings;
  /** Optional per-game overrides for program-standard timing. */
  timing?: Partial<TimingSettings>;
  /** Optional supported practice modes and custom field adapter. */
  practice?: {
    modes: PracticeMode[];
    scrimmage?: boolean;
    field?: PracticeField<GamePracticeData, GameEvaluation>;
  };
}

export interface V5Quadrant {
  id: string;
  label: string;
  alliance: "red" | "blue";
  red: number;
  blue: number;
  yellow: number;
  toggle: "red" | "yellow" | "blue";
}

export interface V5PracticeData {
  quadrants: V5Quadrant[];
  midfield: {
    red: number;
    blue: number;
    yellow: number;
    redRobots: number;
    blueRobots: number;
  };
  autonomousBonus: { red: boolean; blue: boolean };
}

export type V5PracticeEvaluation =
  | { kind: "skills"; counts: number[]; score: number }
  | {
      kind: "scrimmage";
      scores: Record<"red" | "blue", { counts: number[]; score: number }>;
      autonomousBonus: Record<"red" | "blue", number>;
    };
