use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

// ── Application State ────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerInfo {
    pub title: String,
    pub tooltip: String,
    pub running: bool,
}

pub struct AppState {
    pub timer_info: Mutex<TimerInfo>,
}

// ── Tauri Commands ───────────────────────────

#[tauri::command]
fn init_app(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("App initialized from frontend");
    let _ = app;
    Ok(())
}

#[tauri::command]
fn update_tray(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    title: String,
    tooltip: String,
    running: bool,
) -> Result<(), String> {
    let mut info = state.timer_info.lock().map_err(|e| e.to_string())?;
    *info = TimerInfo {
        title,
        tooltip,
        running,
    };

    // Update tray tooltip
    if let Some(tray) = app.tray_by_id("pomodoro-tray") {
        let _ = tray.set_tooltip(Some(&info.tooltip));
        // Update the title via a menu item or just the tooltip
        // The tray can show a title on some platforms
        let _ = tray.set_title(Some(&info.title));
    }

    Ok(())
}

#[tauri::command]
fn set_always_on_top(
    app: tauri::AppHandle,
    always_on_top: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_always_on_top(always_on_top).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn toggle_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Generate Tray Icon Programmatically ──────
fn generate_tray_icon(running: bool) -> Image<'static> {
    let size = 32u32;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);

    let cx = size as f32 / 2.0;
    let cy = size as f32 / 2.0;
    let r = size as f32 / 2.0 - 2.0;
    let r2 = size as f32 / 2.0 - 4.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - cx + 0.5;
            let dy = y as f32 - cy + 0.5;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist <= r {
                if dist <= r2 && running {
                    // Inner filled circle when running (brighter)
                    rgba.extend_from_slice(&[239, 83, 80, 255]); // Tomato red
                } else if dist <= r2 {
                    // Inner circle when paused (slightly darker)
                    rgba.extend_from_slice(&[200, 60, 60, 255]);
                } else {
                    // Border ring
                    let alpha = if running { 220 } else { 180 };
                    rgba.extend_from_slice(&[239, 83, 80, alpha]);
                }
            } else {
                // Transparent outside
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }

    Image::new_owned(rgba, size, size)
}

// ── App Setup ────────────────────────────────

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            timer_info: Mutex::new(TimerInfo {
                title: "🍅 番茄钟".to_string(),
                tooltip: "番茄钟 - 就绪".to_string(),
                running: false,
            }),
        })
        .invoke_handler(tauri::generate_handler![
            init_app,
            update_tray,
            set_always_on_top,
            toggle_window,
        ])
        .setup(|app| {
            // Create tray icon
            let icon = generate_tray_icon(false);

            // Build tray menu
            let toggle_item = MenuItemBuilder::with_id("toggle", "▶ 开始")
                .build(app)?;
            let reset_item = MenuItemBuilder::with_id("reset", "↺ 重置")
                .build(app)?;
            let skip_item = MenuItemBuilder::with_id("skip", "⏭ 跳过")
                .build(app)?;
            let separator1 = PredefinedMenuItem::separator(app)?;
            let work_item = MenuItemBuilder::with_id("work", "🍅 专注")
                .build(app)?;
            let short_break_item = MenuItemBuilder::with_id("short_break", "☕ 短休息")
                .build(app)?;
            let long_break_item = MenuItemBuilder::with_id("long_break", "🌿 长休息")
                .build(app)?;
            let separator2 = PredefinedMenuItem::separator(app)?;
            let show_item = MenuItemBuilder::with_id("show", "📌 显示/隐藏窗口")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "✕ 退出")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&toggle_item)
                .item(&reset_item)
                .item(&skip_item)
                .item(&separator1)
                .item(&work_item)
                .item(&short_break_item)
                .item(&long_break_item)
                .item(&separator2)
                .item(&show_item)
                .item(&quit_item)
                .build()?;

            let tray = TrayIconBuilder::with_id("pomodoro-tray")
                .icon(icon)
                .menu(&menu)
                .tooltip("🍅 番茄钟 - 就绪")
                .on_menu_event(move |app, event| {
                    let id = event.id().as_ref();
                    let window = app.get_webview_window("main");

                    // Helper to run JS in the window
                    let eval_in_window = |js: &str| {
                        if let Some(ref w) = window {
                            let _ = w.eval(js);
                        }
                    };

                    match id {
                        "toggle" => {
                            eval_in_window(
                                "if(window.__pomodoro) window.__pomodoro.toggle()",
                            );
                        }
                        "reset" => {
                            eval_in_window(
                                "if(window.__pomodoro) window.__pomodoro.reset()",
                            );
                        }
                        "skip" => {
                            eval_in_window(
                                "if(window.__pomodoro) window.__pomodoro.skip()",
                            );
                        }
                        "work" => {
                            eval_in_window(
                                "if(window.__pomodoro) window.__pomodoro.switchWork()",
                            );
                        }
                        "short_break" => {
                            eval_in_window(
                                "if(window.__pomodoro) window.__pomodoro.switchShortBreak()",
                            );
                        }
                        "long_break" => {
                            eval_in_window(
                                "if(window.__pomodoro) window.__pomodoro.switchLongBreak()",
                            );
                        }
                        "show" => {
                            if let Some(ref w) = window {
                                if w.is_visible().unwrap_or(false) {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Left click to show/hide window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Store reference to prevent drop
            let _ = tray;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
