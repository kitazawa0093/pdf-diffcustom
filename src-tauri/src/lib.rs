mod data_dir;

use tauri_plugin_fs::FsExt;

#[tauri::command]
fn get_data_root() -> Result<String, String> {
    Ok(data_dir::resolve_data_root()?
        .to_string_lossy()
        .to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let data_root = data_dir::resolve_data_root()?;
            app.handle().fs_scope().allow_directory(&data_root, true)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_data_root])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
