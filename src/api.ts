import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  Bundle,
  CopyPreview,
  ExportArtifact,
  HealthReport,
  OpLogEntry,
  PolicyTemplate,
  ProjectProfile,
  ProjectRoot,
  RegistryCommandResult,
  SkillDetail,
  SkillFilter,
  SkillRecord,
  SourceInfo,
  TwinGroup,
  UsageInsights,
  ContentHistoryEntry,
} from "./types";

export const api = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (settings: AppSettings) =>
    invoke<AppSettings>("update_settings", { settings }),
  listSkills: (filter: SkillFilter = {}) =>
    invoke<SkillRecord[]>("list_skills", { filter }),
  getSkillDetail: (id: string) =>
    invoke<SkillDetail>("get_skill_detail", { id }),
  scanNow: () => invoke<number>("scan_now"),
  listSources: () => invoke<SourceInfo[]>("list_sources"),
  listTwinGroups: () => invoke<TwinGroup[]>("list_twin_groups"),
  listProjects: () => invoke<ProjectRoot[]>("list_projects"),
  addProject: (path: string) => invoke<ProjectRoot>("add_project", { path }),
  removeProject: (path: string) => invoke("remove_project", { path }),
  setTargetProject: (path: string) =>
    invoke<AppSettings>("set_target_project", { path }),
  previewCopy: (
    skillIds: string[],
    project: string,
    runtimes: string[],
    conflictPolicy: string,
  ) =>
    invoke<CopyPreview>("preview_copy_skills", {
      skillIds,
      project,
      runtimes,
      conflictPolicy,
    }),
  executeCopy: (preview: CopyPreview, conflictPolicy: string) =>
    invoke<OpLogEntry>("execute_copy_skills", { preview, conflictPolicy }),
  deleteImpact: (skillIds: string[]) =>
    invoke<{ items: Array<Record<string, unknown>> }>("delete_impact", {
      skillIds,
    }),
  deleteSkills: (skillIds: string[]) =>
    invoke<OpLogEntry>("delete_skills_cmd", { skillIds }),
  extractSkill: (skillId: string) =>
    invoke<OpLogEntry>("extract_skill", { skillId }),
  syncTwin: (sourceId: string, targetId: string) =>
    invoke<OpLogEntry>("sync_twin_skills", { sourceId, targetId }),
  listBundles: () => invoke<Bundle[]>("list_bundles"),
  createBundle: (
    name: string,
    description: string | null,
    skillIds: string[],
    defaultRuntimes: string[],
  ) =>
    invoke<Bundle>("create_bundle_cmd", {
      name,
      description,
      skillIds,
      defaultRuntimes,
    }),
  deleteBundle: (id: string) => invoke("delete_bundle_cmd", { id }),
  applyBundle: (
    bundleId: string,
    project: string,
    runtimes: string[] | null,
    conflictPolicy: string,
  ) =>
    invoke<OpLogEntry>("apply_bundle_cmd", {
      bundleId,
      project,
      runtimes,
      conflictPolicy,
    }),
  importBundle: (json: string) =>
    invoke<Bundle>("import_bundle_cmd", { json }),
  exportBundle: (id: string) => invoke<string>("export_bundle_cmd", { id }),
  listOplog: (limit = 50) => invoke<OpLogEntry[]>("list_oplog", { limit }),
  setFavorite: (id: string, favorite: boolean) =>
    invoke("set_favorite", { id, favorite }),
  reveal: (path: string) => invoke("reveal_in_explorer", { path }),
  runHealthScan: () => invoke<number>("run_health_scan"),
  getHealthReport: (skillId: string) =>
    invoke<HealthReport | null>("get_health_report", { skillId }),
  listHealthReports: () => invoke<HealthReport[]>("list_health_reports"),
  applyHealthFix: (skillId: string, ruleId: string) =>
    invoke<SkillRecord>("apply_health_fix", { skillId, ruleId }),
  analyzeProject: (path: string) =>
    invoke<ProjectProfile>("analyze_project", { path }),
  createBundleFromRecommendation: (title: string, skillIds: string[]) =>
    invoke<Bundle>("create_bundle_from_recommendation", { title, skillIds }),
  registryFind: (query: string) =>
    invoke<RegistryCommandResult>("registry_find", { query }),
  registryList: (global: boolean) =>
    invoke<RegistryCommandResult>("registry_list", { global }),
  registryAdd: (
    packageName: string,
    global: boolean,
    agents: string[],
    skill?: string | null,
  ) =>
    invoke<RegistryCommandResult>("registry_add", {
      package: packageName,
      global,
      agents,
      skill: skill ?? null,
    }),
  registryUpdate: (global: boolean) =>
    invoke<RegistryCommandResult>("registry_update", { global }),
  registryRemove: (name: string, global: boolean) =>
    invoke<RegistryCommandResult>("registry_remove", { name, global }),
  listPolicyTemplates: () => invoke<PolicyTemplate[]>("list_policy_templates"),
  applyPolicyTemplate: (templateId: string) =>
    invoke<AppSettings>("apply_policy_template", { templateId }),
  exportSkillsZip: (skillIds: string[]) =>
    invoke<ExportArtifact>("export_skills_zip_cmd", { skillIds }),
  importSkillsZip: (zipBase64: string, targetRoot?: string | null) =>
    invoke<OpLogEntry>("import_skills_zip_cmd", {
      zipBase64,
      targetRoot: targetRoot ?? null,
    }),
  getUsageInsights: () => invoke<UsageInsights>("get_usage_insights"),
  listContentHistory: (skillId: string) =>
    invoke<ContentHistoryEntry[]>("list_content_history_cmd", { skillId }),
};
