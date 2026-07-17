export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  dirPath: string;
  entryPath: string;
  realpath: string;
  isSymlink: boolean;
  sourceId: string;
  runtime: string;
  scope: string;
  origin: string;
  access: string;
  projectRoot?: string | null;
  contentHash: string;
  entryMtimeMs: number;
  hasScripts: boolean;
  frontmatterFlags: Record<string, unknown>;
  tags: string[];
  favorite: boolean;
  twinGroupId?: string | null;
  healthScore?: number | null;
  lastUsedAt?: number | null;
  indexedAt: number;
  error?: string | null;
}

export interface OutlineHeading {
  level: number;
  text: string;
}

export interface HealthIssue {
  ruleId: string;
  severity: string;
  message: string;
  fixHint?: string | null;
  autoFix: boolean;
}

export interface RegistrySyncInfo {
  status: string;
  source?: string | null;
  sourceUrl?: string | null;
  lockFolderHash?: string | null;
  localSkillMdHash: string;
  remoteSkillMdHash?: string | null;
  remoteFetchedUrl?: string | null;
  diff?: string | null;
  message: string;
}

export interface HealthReport {
  skillId: string;
  skillName: string;
  score: number;
  grade: string;
  issues: HealthIssue[];
  contentHash: string;
  registry?: RegistrySyncInfo | null;
  dirPath?: string | null;
}

export interface AppSettings {
  multiRuntimeSync: boolean;
  conflictPolicy: string;
  alsoWriteNativeCursor: boolean;
  targetProject?: string | null;
  enabledSourceIds: string[];
  writeRuntimes: string[];
  policyTemplateId?: string;
  blockPluginCopyToProject?: boolean;
}

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  conflictPolicy: string;
  blockPluginCopyToProject: boolean;
  preferProjectOverGlobal: boolean;
}

export interface ExportArtifact {
  filename: string;
  base64: string;
  skillCount: number;
}

export interface ScriptRiskFinding {
  ruleId: string;
  severity: string;
  file: string;
  line: number;
  snippet: string;
  message: string;
}

export interface ContentHistoryEntry {
  id: string;
  skillId: string;
  skillName: string;
  contentHash: string;
  event: string;
  ts: number;
}

export interface UsageInsights {
  favorites: SkillRecord[];
  recent: SkillRecord[];
}

export interface SkillDetail {
  skill: SkillRecord;
  bodyMarkdown: string;
  frontmatterRaw: string;
  outline: OutlineHeading[];
  files: string[];
  twins: SkillRecord[];
  health?: HealthReport | null;
  scriptRisks?: ScriptRiskFinding[];
  contentHistory?: ContentHistoryEntry[];
}

export interface BundleRecommendation {
  title: string;
  reason: string;
  skillNames: string[];
  matchedSkillIds: string[];
  missingNames: string[];
}

export interface ProjectProfile {
  path: string;
  stacks: string[];
  recommendations: BundleRecommendation[];
}

export interface ScaffoldResult {
  projectPath: string;
  created: string[];
  skipped: string[];
}

export interface RegistryCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface TwinGroup {
  id: string;
  keyType: string;
  key: string;
  status: string;
  skillIds: string[];
}

export interface ProjectRoot {
  id: string;
  path: string;
  displayName: string;
  lastUsedAt: number;
}

export interface BundleItem {
  skillRef:
    | { by: "id"; value: string }
    | { by: "name+hash"; name: string; contentHash: string };
  optional: boolean;
}

export interface Bundle {
  id: string;
  name: string;
  description?: string | null;
  items: BundleItem[];
  defaultRuntimes: string[];
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface OpLogEntry {
  id: string;
  ts: number;
  op: string;
  status: string;
  sources: string[];
  targets: string[];
  detail: Record<string, unknown>;
}

export interface SourceInfo {
  id: string;
  label: string;
  runtime: string;
  scope: string;
  origin: string;
  access: string;
  enabled: boolean;
  pathPatterns: string[];
  resolvedRoots: string[];
  skillCount: number;
}

export interface SkillFilter {
  query?: string | null;
  runtimes?: string[] | null;
  scopes?: string[] | null;
  origins?: string[] | null;
  sourceIds?: string[] | null;
  hasScripts?: boolean | null;
  twinsOnly?: boolean | null;
  favoritesOnly?: boolean | null;
  tag?: string | null;
  projectRoot?: string | null;
}

export interface TwinDiff {
  leftId: string;
  rightId: string;
  leftLabel: string;
  rightLabel: string;
  identical: boolean;
  diff: string;
}

export interface CopyPlanItem {
  skillId: string;
  skillName: string;
  sourcePath: string;
  targetPath: string;
  action: string;
}

export interface CopyPreview {
  items: CopyPlanItem[];
}
