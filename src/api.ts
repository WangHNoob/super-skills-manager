import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  Bundle,
  CopyPreview,
  OpLogEntry,
  ProjectRoot,
  SkillDetail,
  SkillFilter,
  SkillRecord,
  SourceInfo,
  TwinGroup,
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
};
