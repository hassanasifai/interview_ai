use tauri::command;

pub(crate) const SERVICE_NAME: &str = "meetingmind";

/// Internal non-command version for use within commands.rs
pub(crate) fn retrieve_api_key_inner(provider: &str) -> Result<Option<String>, String> {
    match keyring::Entry::new(SERVICE_NAME, provider)
        .map_err(|e| e.to_string())?
        .get_password()
    {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Store an API key in the OS native keychain.
/// On Windows this uses Credential Manager; on macOS it uses Keychain.
#[command]
pub fn store_api_key(provider: String, api_key: String) -> Result<(), String> {
    keyring::Entry::new(SERVICE_NAME, &provider)
        .map_err(|e| e.to_string())?
        .set_password(&api_key)
        .map_err(|e| e.to_string())
}

/// Retrieve an API key from the OS native keychain.
/// Returns None if no key has been stored for this provider.
#[command]
pub fn retrieve_api_key(provider: String) -> Result<Option<String>, String> {
    match keyring::Entry::new(SERVICE_NAME, &provider)
        .map_err(|e| e.to_string())?
        .get_password()
    {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete an API key from the OS native keychain.
#[command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    match keyring::Entry::new(SERVICE_NAME, &provider)
        .map_err(|e| e.to_string())?
        .delete_credential()
    {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
