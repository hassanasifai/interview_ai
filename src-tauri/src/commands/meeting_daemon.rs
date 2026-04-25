use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{command, AppHandle, Emitter, State};


pub struct MeetingDaemon {
    stop_flag: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl MeetingDaemon {
    pub fn start(app: AppHandle) -> Self {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let flag = stop_flag.clone();

        let thread = std::thread::spawn(move || {
            use rand::Rng;
            let mut rng = rand::thread_rng();
            while !flag.load(Ordering::Relaxed) {
                if let Ok(info) = crate::commands::platform_active_window_info() {
                    let _ = app.emit("meeting_daemon_tick", &info);
                }
                // Base interval 2 s plus a random jitter of 50–250 ms so the
                // polling cadence is not fingerprint-able as a fixed period.
                let jitter_ms = rng.gen_range(50u64..=250u64);
                std::thread::sleep(std::time::Duration::from_millis(2_000 + jitter_ms));
            }
        });

        Self {
            stop_flag,
            thread: Some(thread),
        }
    }

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for MeetingDaemon {
    fn drop(&mut self) {
        self.stop();
    }
}

pub type MeetingDaemonStateInner = Mutex<Option<MeetingDaemon>>;

#[command]
pub fn start_meeting_daemon(
    app: AppHandle,
    state: State<'_, crate::commands::MeetingDaemonState>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(MeetingDaemon::start(app));
    }
    Ok(())
}

#[command]
pub fn stop_meeting_daemon(state: State<'_, crate::commands::MeetingDaemonState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut daemon) = guard.take() {
        daemon.stop();
    }
    Ok(())
}
