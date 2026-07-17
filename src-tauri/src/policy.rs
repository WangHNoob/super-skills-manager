use crate::models::{AppSettings, PolicyTemplate};

pub fn builtin_templates() -> Vec<PolicyTemplate> {
    vec![
        PolicyTemplate {
            id: "balanced".into(),
            name: "均衡（默认）".into(),
            description: "冲突时覆盖；允许从插件提取后写入项目。".into(),
            conflict_policy: "overwrite".into(),
            block_plugin_copy_to_project: false,
            prefer_project_over_global: true,
        },
        PolicyTemplate {
            id: "conservative".into(),
            name: "保守".into(),
            description: "冲突跳过；禁止把插件源 skill 直接拷进项目。".into(),
            conflict_policy: "skip".into(),
            block_plugin_copy_to_project: true,
            prefer_project_over_global: true,
        },
        PolicyTemplate {
            id: "force_project".into(),
            name: "项目优先覆盖".into(),
            description: "一律覆盖目标；适合用已验证组合刷新仓库。".into(),
            conflict_policy: "overwrite".into(),
            block_plugin_copy_to_project: false,
            prefer_project_over_global: true,
        },
        PolicyTemplate {
            id: "rename_keep_both".into(),
            name: "保留双方".into(),
            description: "冲突时重命名新副本，不覆盖已有 skill。".into(),
            conflict_policy: "rename".into(),
            block_plugin_copy_to_project: true,
            prefer_project_over_global: false,
        },
    ]
}

pub fn apply_template(settings: &mut AppSettings, template_id: &str) -> Result<(), String> {
    let t = builtin_templates()
        .into_iter()
        .find(|x| x.id == template_id)
        .ok_or_else(|| format!("未知策略模板: {template_id}"))?;
    settings.policy_template_id = t.id.clone();
    settings.conflict_policy = t.conflict_policy;
    settings.block_plugin_copy_to_project = t.block_plugin_copy_to_project;
    Ok(())
}

pub fn resolve_conflict_policy(settings: &AppSettings) -> String {
    settings.conflict_policy.clone()
}
