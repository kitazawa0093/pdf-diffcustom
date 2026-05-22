use std::path::PathBuf;

/// ポータブル運用向け: 実行ファイル（または .app）と同じ階層を「設置フォルダ」とする。
pub fn resolve_install_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "実行ファイルのパスを取得できません".to_string())?;

    // macOS: MyApp.app/Contents/MacOS/binary → MyApp.app と同じフォルダ
    if exe_dir.file_name().and_then(|n| n.to_str()) == Some("MacOS") {
        if let Some(contents) = exe_dir.parent() {
            if contents.file_name().and_then(|n| n.to_str()) == Some("Contents") {
                if let Some(app_bundle) = contents.parent() {
                    if app_bundle
                        .extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("app"))
                    {
                        return Ok(app_bundle
                            .parent()
                            .map(|p| p.to_path_buf())
                            .unwrap_or_else(|| app_bundle.to_path_buf()));
                    }
                }
            }
        }
    }

    // Windows / Linux 開発ビルド: 実行ファイルと同じフォルダ
    Ok(exe_dir.to_path_buf())
}

pub fn resolve_data_root() -> Result<PathBuf, String> {
    let root = resolve_install_dir()?.join("data");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}
