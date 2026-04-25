use keyring::Entry;

const SERVICE: &str = "dev.jace.imgplayground";

pub fn set_key(provider: &str, value: &str) -> anyhow::Result<()> {
    let entry = Entry::new(SERVICE, provider)?;
    entry.set_password(value)?;
    Ok(())
}

pub fn get_key(provider: &str) -> anyhow::Result<Option<String>> {
    let entry = Entry::new(SERVICE, provider)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_key(provider: &str) -> anyhow::Result<()> {
    let entry = Entry::new(SERVICE, provider)?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
