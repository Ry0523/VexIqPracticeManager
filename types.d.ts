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
  criteria: Record<string, { score: number | null; scoredOn: string | null; note: string; notedOn: string | null }>;
  reviews: number;
  latest: ReviewEvaluation;
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
  empty(): GameData;
  validate(data: GameData): GameData | void;
  evaluate(mode: PracticeMode, data: GameData): Evaluation;
  normalizeForMode?(mode: PracticeMode, data: GameData): GameData;
}

export interface PracticeView<GameData = unknown, Evaluation = unknown> {
  render(context: { mode: PracticeMode; data: GameData }): void;
  read(mode: PracticeMode): GameData;
  update(context: { mode: PracticeMode; data: GameData; result: Evaluation | null }): void;
  handleClick(event: MouseEvent): boolean;
}

export interface GameDefinition<GameGoals = unknown, GamePracticeData = unknown, GameEvaluation = unknown> {
  id: string;
  name: string;
  program: string;
  season: string;
  score(counts: number[]): number;
  emptyGoals(): GameGoals;
  goalCounts(goals: GameGoals): number[];
  goalsFromCounts(counts: number[]): GameGoals;
  skillsTiebreak(counts: number[]): number[];
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