use tauri_plugin_updater::UpdaterExt;

/* OTA 自动更新：check（版本对比）→ download_and_install（Ed25519 验签 + SHA256 + 落盘）→ 安装重启。
   任一环节失败均静默忽略，不打扰用户；更新清单来自 GitHub Releases latest.json。 */
async fn run_ota(app: tauri::AppHandle) {
    // 启动 8 秒后再检查，避免抢占首屏加载
    std::thread::sleep(std::time::Duration::from_secs(8));

    let Ok(updater) = app.updater() else {
        return;
    };
    let Ok(update) = updater.check().await else {
        return;
    };

    let mut downloaded: u64 = 0;
    let on_chunk = |chunk: usize, total: Option<u64>| {
        downloaded += chunk as u64;
        let _ = total;
    };
    if update.download_and_install(on_chunk, || {}).await.is_ok() {
        // 安装成功后重启（Windows 下安装器会自行接管退出）
        app.restart();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            tauri::async_runtime::spawn(run_ota(app.handle().clone()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
