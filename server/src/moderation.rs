use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fmt,
    sync::{
        atomic::{AtomicUsize, Ordering},
        OnceLock,
    },
    time::{Duration, Instant},
};

const NIM_URL: &str = "https://integrate.api.nvidia.com/v1/chat/completions";
const PRIMARY_DEFAULT: &str = "meta/llama-guard-4-12b";
const FALLBACK_DEFAULT: &str = "nvidia/nemotron-3.5-super-vl-120b-a12b";

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static NEXT_KEY: AtomicUsize = AtomicUsize::new(0);
static PRIMARY_DOWN_UNTIL: OnceLock<parking_lot::Mutex<Option<Instant>>> = OnceLock::new();

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Block(String),
}

#[derive(Debug)]
pub enum ReviewError {
    Unreadable(String),
    Unavailable(String),
}

impl fmt::Display for ReviewError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable(error) | Self::Unavailable(error) => f.write_str(error),
        }
    }
}

enum CallError {
    NotFound,
    Failed(String),
}

fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .build()
            .expect("moderation http client")
    })
}

fn keys() -> Vec<String> {
    std::env::var("YAP_NIM_KEYS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_owned)
        .collect()
}

async fn completion(body: Value) -> Result<String, CallError> {
    let keys = keys();
    if keys.is_empty() {
        return Err(CallError::Failed("no NVIDIA NIM keys configured".into()));
    }
    let attempts = keys.len().min(3);
    let first = NEXT_KEY.fetch_add(1, Ordering::Relaxed);
    let mut last = "NVIDIA NIM request failed".to_owned();
    let mut not_found = false;
    for offset in 0..attempts {
        let key = &keys[(first + offset) % keys.len()];
        let response = client()
            .post(NIM_URL)
            .bearer_auth(key)
            .json(&body)
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                last = error.to_string();
                continue;
            }
        };
        if response.status().as_u16() == 404 {
            not_found = true;
            last = format!("NVIDIA NIM returned {}", response.status());
            continue;
        }
        if !response.status().is_success() {
            last = format!("NVIDIA NIM returned {}", response.status());
            continue;
        }
        let payload: Value = match response.json().await {
            Ok(payload) => payload,
            Err(error) => {
                last = error.to_string();
                continue;
            }
        };
        if let Some(content) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
        {
            return Ok(content.to_owned());
        }
        last = "NVIDIA NIM response had no message content".into();
    }
    if not_found {
        Err(CallError::NotFound)
    } else {
        Err(CallError::Failed(last))
    }
}

fn primary_is_down() -> bool {
    PRIMARY_DOWN_UNTIL
        .get_or_init(|| parking_lot::Mutex::new(None))
        .lock()
        .is_some_and(|until| Instant::now() < until)
}

fn cache_primary_down() {
    *PRIMARY_DOWN_UNTIL
        .get_or_init(|| parking_lot::Mutex::new(None))
        .lock() = Some(Instant::now() + Duration::from_secs(600));
}

fn parse_primary(content: &str) -> Result<Verdict, ()> {
    let mut lines = content.lines();
    let verdict = lines.next().ok_or(())?.trim().to_ascii_lowercase();
    let codes = lines.next().map(str::trim).filter(|line| !line.is_empty());
    if lines.any(|line| !line.trim().is_empty()) {
        return Err(());
    }
    match verdict.as_str() {
        "safe" => Ok(Verdict::Allow),
        "unsafe" => {
            let Some(codes) = codes else {
                return Ok(Verdict::Block("unsafe".into()));
            };
            let irrelevant = ["S8", "S13", "S14"];
            let code_list: Vec<_> = codes
                .split(',')
                .map(str::trim)
                .filter(|code| !code.is_empty())
                .collect();
            let all_irrelevant = !code_list.is_empty()
                && code_list.iter().all(|code| irrelevant.iter().any(|allowed| code.eq_ignore_ascii_case(allowed)));
            if all_irrelevant {
                return Ok(Verdict::Allow);
            }
            Ok(Verdict::Block(codes.chars().take(60).collect()))
        }
        _ => Err(()),
    }
}

fn parse_fallback(content: &str) -> Result<Verdict, ()> {
    let start = content.find('{').ok_or(())?;
    let mut deserializer = serde_json::Deserializer::from_str(&content[start..]);
    let result = Value::deserialize(&mut deserializer).map_err(|_| ())?;
    match result.get("verdict").and_then(Value::as_str) {
        Some("allow") => Ok(Verdict::Allow),
        Some("block") => Ok(Verdict::Block(
            result
                .get("category")
                .and_then(Value::as_str)
                .filter(|category| !category.is_empty())
                .unwrap_or("unsafe")
                .chars()
                .take(60)
                .collect(),
        )),
        _ => Err(()),
    }
}

fn primary_body(model: &str, frame: &[u8]) -> Value {
    json!({
        "model": model,
        "temperature": 0,
        "max_tokens": 20,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "text", "text": "Sticker uploaded to a public chat app used by teenagers aged 13 and up." },
                { "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{}", STANDARD.encode(frame)) } }
            ]
        }]
    })
}

fn fallback_body(model: &str, frames: &[Vec<u8>]) -> Value {
    let mut content = vec![json!({ "type": "text", "text": "Review these frames." })];
    content.extend(frames.iter().map(|frame| {
        json!({ "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{}", STANDARD.encode(frame)) } })
    }));
    json!({
        "model": model,
        "temperature": 0,
        "max_tokens": 60,
        "chat_template_kwargs": { "enable_thinking": false },
        "messages": [
            { "role": "system", "content": include_str!("moderation_prompt.txt") },
            { "role": "user", "content": content }
        ]
    })
}

pub async fn review(input: &[u8]) -> Result<Verdict, ReviewError> {
    let frames = crate::converter::moderation_frames(input).await;
    if frames.is_empty() {
        return Err(ReviewError::Unreadable("could not extract moderation frames".into()));
    }

    let primary_model = std::env::var("YAP_MOD_PRIMARY").unwrap_or_else(|_| PRIMARY_DEFAULT.into());
    let mut fallback = primary_is_down();
    if !fallback {
        for (index, frame) in frames.iter().enumerate() {
            match completion(primary_body(&primary_model, frame)).await {
                Ok(content) => match parse_primary(&content) {
                    Ok(Verdict::Allow) => {
                        tracing::info!(model = %primary_model, verdict = "allow", frame = index + 1, "sticker moderation");
                    }
                    Ok(Verdict::Block(category)) => {
                        tracing::info!(model = %primary_model, verdict = "block", frame = index + 1, "sticker moderation");
                        return Ok(Verdict::Block(category));
                    }
                    Err(()) => {
                        fallback = true;
                        break;
                    }
                },
                Err(CallError::NotFound) => {
                    cache_primary_down();
                    fallback = true;
                    break;
                }
                Err(CallError::Failed(_)) => {
                    fallback = true;
                    break;
                }
            }
        }
        if !fallback {
            return Ok(Verdict::Allow);
        }
    }

    let fallback_model = std::env::var("YAP_MOD_MODEL").unwrap_or_else(|_| FALLBACK_DEFAULT.into());
    match completion(fallback_body(&fallback_model, &frames)).await {
        Ok(content) => {
            let verdict = parse_fallback(&content).map_err(|_| {
                ReviewError::Unavailable("could not parse moderation response".into())
            })?;
            tracing::info!(
                model = %fallback_model,
                verdict = if matches!(&verdict, Verdict::Allow) { "allow" } else { "block" },
                "sticker moderation"
            );
            Ok(verdict)
        }
        Err(CallError::NotFound) => Err(ReviewError::Unavailable("moderation model not found".into())),
        Err(CallError::Failed(error)) => Err(ReviewError::Unavailable(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_primary, Verdict};

    #[test]
    fn llama_guard_parser_handles_safe_and_unsafe_codes() {
        assert_eq!(parse_primary("safe"), Ok(Verdict::Allow));
        assert_eq!(parse_primary("unsafe\nS12"), Ok(Verdict::Block("S12".into())));
        assert_eq!(parse_primary("unsafe\nS8"), Ok(Verdict::Allow));
        assert_eq!(parse_primary("unsafe\nS8,S1"), Ok(Verdict::Block("S8,S1".into())));
        assert_eq!(parse_primary("unsafe"), Ok(Verdict::Block("unsafe".into())));
        assert_eq!(parse_primary("maybe"), Err(()));
    }
}
