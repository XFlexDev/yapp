use std::process::Stdio;
use tokio::process::Command;

pub struct ConvertedSticker {
    pub webp_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub is_animated: bool,
}

pub fn parse_webp_info(b: &[u8]) -> Option<(u32, u32, bool)> {
    if b.len() < 30 || &b[0..4] != b"RIFF" || &b[8..12] != b"WEBP" {
        return None;
    }
    let chunk = &b[12..16];
    if chunk == b"VP8 " {
        let w = (u16::from_le_bytes([b[26], b[27]]) & 0x3fff) as u32;
        let h = (u16::from_le_bytes([b[28], b[29]]) & 0x3fff) as u32;
        Some((w, h, false))
    } else if chunk == b"VP8L" {
        let b1 = b[21] as u32;
        let b2 = b[22] as u32;
        let b3 = b[23] as u32;
        let b4 = b[24] as u32;
        let w = 1 + (((b2 & 0x3f) << 8) | b1);
        let h = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
        Some((w, h, false))
    } else if chunk == b"VP8X" {
        let flags = b[20];
        let has_anim = (flags & 0x02) != 0;
        let w = 1 + (b[24] as u32 | ((b[25] as u32) << 8) | ((b[26] as u32) << 16));
        let h = 1 + (b[27] as u32 | ((b[28] as u32) << 8) | ((b[29] as u32) << 16));
        Some((w, h, has_anim))
    } else {
        None
    }
}

async fn probe_dimensions(path: &str) -> Option<(u32, u32)> {
    let out = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=s=x:p=0",
            path,
        ])
        .output()
        .await
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let mut parts = s.trim().split('x');
    let w: u32 = parts.next()?.parse().ok()?;
    let h: u32 = parts.next()?.parse().ok()?;
    Some((w, h))
}

pub async fn convert_to_optimized_webp(input_bytes: &[u8], is_emoji: bool) -> Result<ConvertedSticker, String> {
    let tmp_in = format!("/tmp/stk_in_{}.bin", uuid::Uuid::new_v4());
    let tmp_out = format!("/tmp/stk_out_{}.webp", uuid::Uuid::new_v4());

    tokio::fs::write(&tmp_in, input_bytes).await.map_err(|e| e.to_string())?;

    let filter = if is_emoji {
        "fps=24,scale='min(128,iw)':'min(128,ih)':force_original_aspect_ratio=decrease"
    } else {
        "fps=24,scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease"
    };

    let duration = if is_emoji { "2.5" } else { "3.0" };

    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-t")
        .arg(duration)
        .arg("-i")
        .arg(&tmp_in)
        .arg("-vf")
        .arg(filter)
        .arg("-vcodec")
        .arg("libwebp")
        .arg("-lossless")
        .arg("0")
        .arg("-compression_level")
        .arg("4")
        .arg("-q:v")
        .arg("75")
        .arg("-loop")
        .arg("0")
        .arg(&tmp_out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("ffmpeg execution failed: {e}"))?;

    let _ = tokio::fs::remove_file(&tmp_in).await;

    if !status.success() {
        let _ = tokio::fs::remove_file(&tmp_out).await;
        return Err("Failed to convert image/video to WebP format".into());
    }

    let webp_bytes = match tokio::fs::read(&tmp_out).await {
        Ok(b) => b,
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp_out).await;
            return Err(e.to_string());
        }
    };

    let (mut width, mut height, is_animated) = parse_webp_info(&webp_bytes).unwrap_or((0, 0, false));
    if width == 0 || height == 0 {
        if let Some((pw, ph)) = probe_dimensions(&tmp_out).await {
            width = pw;
            height = ph;
        } else {
            width = if is_emoji { 128 } else { 512 };
            height = width;
        }
    }
    let _ = tokio::fs::remove_file(&tmp_out).await;

    Ok(ConvertedSticker {
        webp_bytes,
        width,
        height,
        is_animated,
    })
}
