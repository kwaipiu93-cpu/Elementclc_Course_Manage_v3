use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub jwt_secret: String,
    pub static_dir: PathBuf,
    pub deepseek_api_key: Option<String>,
}

impl Config {
    pub fn from_env() -> color_eyre::Result<Self> {
        dotenvy::dotenv().ok();
        Ok(Self {
            port: std::env::var("PORT").unwrap_or_else(|_| "8000".into()).parse()?,
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite:instance/data.db".into()),
            jwt_secret: std::env::var("JWT_SECRET")
                .unwrap_or_else(|_| "change-me-in-production".into()),
            static_dir: PathBuf::from(
                std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into()),
            ),
            deepseek_api_key: std::env::var("DEEPSEEK_API_KEY").ok(),
        })
    }
}
