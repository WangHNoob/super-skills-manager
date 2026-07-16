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
  indexedAt: number;
  error?: string | null;
}

export interface OutlineHeading {
  level: number;
  text: string;
}

export interface SkillDetail {
  skill: SkillRecord;
  bodyMarkdown: string;
  frontmatterRaw: string;
  outline: OutlineHeading[];
  files: string[];
  twins: SkillRecord[];
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

export interface AppSettings {
  multiRuntimeSync: boolean;
  conflictPolicy: string;
  alsoWriteNativeCursor: boolean;
  targetProject?: string | null;
  enabledSourceIds: string[];
  writeRuntimes: string[];
}
