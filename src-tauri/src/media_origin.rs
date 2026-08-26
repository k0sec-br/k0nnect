use url::Url;

pub fn is_trusted_app_origin(uri: &str) -> bool {
    let Ok(url) = Url::parse(uri) else {
        return false;
    };
    match url.host_str() {
        Some("tauri.localhost") => matches!(url.scheme(), "http" | "https"),
        Some("127.0.0.1") => url.scheme() == "http" && url.port() == Some(5174),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_trusted_app_origin;

    #[test]
    fn accepts_only_local_application_origins() {
        assert!(is_trusted_app_origin("http://tauri.localhost/app"));
        assert!(is_trusted_app_origin("https://tauri.localhost/settings"));
        assert!(is_trusted_app_origin("http://127.0.0.1:5174/app"));
        assert!(!is_trusted_app_origin("https://connect.k0sec.org/app"));
        assert!(!is_trusted_app_origin("http://127.0.0.1:4173/app"));
        assert!(!is_trusted_app_origin(
            "https://tauri.localhost.evil.example/app"
        ));
    }
}
