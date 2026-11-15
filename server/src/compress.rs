//! Server-side photo compressor. Every uploaded photo is capped in size and stored as lossy WebP
//! without metadata, so storage does not depend on what the client chose to send.
use image::{imageops::FilterType, DynamicImage, ImageDecoder, ImageReader, Limits};
use std::io::Cursor;
use tokio::sync::Semaphore;

#[derive(Clone, Copy)]
pub struct Spec {
    max_w: u32,
    max_h: u32,
    quality: f32,
}

pub const AVATAR: Spec = Spec { max_w: 1080, max_h: 1920, quality: 78.0 };
pub const PFP: Spec = Spec { max_w: 512, max_h: 512, quality: 78.0 };
pub const CHAT: Spec = Spec { max_w: 1600, max_h: 1600, quality: 75.0 };
pub const BACKGROUND: Spec = Spec { max_w: 1080, max_h: 2400, quality: 72.0 };

pub struct Photo {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

const INVALID: &str = "Upload a JPEG or WebP photo";
/// Largest source image decoded, per side. Covers 48 MP phone photos.
const MAX_SIDE: u32 = 8192;
const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;
/// Bytes per pixel under which a WebP is already compressed enough to store untouched.
const PASS_BYTES_PER_PIXEL: f64 = 0.35;
/// Encodes run off the async threads, two at a time, so they cannot starve live voice.
static SLOTS: Semaphore = Semaphore::const_new(2);

pub async fn run(input: &[u8], spec: Spec) -> Result<Photo, &'static str> {
    if let Some(photo) = pass_through(input, spec) {
        return Ok(photo);
    }
    let input = input.to_vec();
    let _slot = SLOTS.acquire().await.map_err(|_| INVALID)?;
    tokio::task::spawn_blocking(move || encode(&input, spec)).await.map_err(|_| INVALID)?
}

/// A still WebP that fits the spec and carries no EXIF/XMP is kept byte for byte.
fn pass_through(b: &[u8], spec: Spec) -> Option<Photo> {
    let (width, height, animated) = crate::converter::parse_webp_info(b)?;
    let metadata = &b[12..16] == b"VP8X" && b[20] & 0x0c != 0;
    let budget = (width as f64 * height as f64 * PASS_BYTES_PER_PIXEL) as usize + 4096;
    (!animated && !metadata && width <= spec.max_w && height <= spec.max_h && b.len() <= budget)
        .then(|| Photo { bytes: b.to_vec(), width, height })
}

fn encode(input: &[u8], spec: Spec) -> Result<Photo, &'static str> {
    let mut reader = ImageReader::new(Cursor::new(input)).with_guessed_format().map_err(|_| INVALID)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| INVALID)?;
    let orientation = decoder.orientation().map_err(|_| INVALID)?;
    let mut img = DynamicImage::from_decoder(decoder).map_err(|_| INVALID)?;
    img.apply_orientation(orientation);
    if img.width() > spec.max_w || img.height() > spec.max_h {
        img = img.resize(spec.max_w, spec.max_h, FilterType::CatmullRom);
    }
    let (width, height) = (img.width(), img.height());
    let webp = |quality: f32| -> Vec<u8> {
        if img.color().has_alpha() {
            webp::Encoder::from_rgba(&img.to_rgba8(), width, height).encode(quality).to_vec()
        } else {
            webp::Encoder::from_rgb(&img.to_rgb8(), width, height).encode(quality).to_vec()
        }
    };
    let mut bytes = webp(spec.quality);
    // A source that was already squeezed harder than our quality would grow; step down once.
    if bytes.len() > input.len() {
        bytes = webp(spec.quality - 18.0);
    }
    if bytes.is_empty() {
        return Err(INVALID);
    }
    Ok(Photo { bytes, width, height })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgb, RgbImage};

    fn photo(w: u32, h: u32) -> RgbImage {
        RgbImage::from_fn(w, h, |x, y| {
            let n = (x.wrapping_mul(2654435761) ^ y.wrapping_mul(40503)) >> 13;
            Rgb([(x * 255 / w) as u8, (y * 255 / h) as u8, (n & 63) as u8 + 90])
        })
    }

    fn jpeg(img: &RgbImage, quality: u8) -> Vec<u8> {
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality).encode_image(img).unwrap();
        out
    }

    fn is_webp(b: &[u8]) -> bool {
        crate::converter::parse_webp_info(b).is_some()
    }

    #[tokio::test]
    async fn oversized_jpeg_is_resized_and_shrunk() {
        let src = jpeg(&photo(3000, 4000), 95);
        let out = run(&src, CHAT).await.unwrap();
        assert_eq!((out.width, out.height), (1200, 1600));
        assert!(is_webp(&out.bytes));
        assert_eq!(crate::converter::parse_webp_info(&out.bytes).map(|i| (i.0, i.1)), Some((1200, 1600)));
        assert!(out.bytes.len() * 4 < src.len(), "{} vs {}", out.bytes.len(), src.len());
    }

    #[tokio::test]
    async fn png_becomes_webp() {
        let mut src = Vec::new();
        photo(400, 300).write_to(&mut Cursor::new(&mut src), ImageFormat::Png).unwrap();
        let out = run(&src, PFP).await.unwrap();
        assert_eq!((out.width, out.height), (400, 300));
        assert!(is_webp(&out.bytes) && out.bytes.len() < src.len());
    }

    #[tokio::test]
    async fn compact_webp_passes_through_untouched() {
        let src = webp::Encoder::from_rgb(&photo(1080, 1920), 1080, 1920).encode(78.0).to_vec();
        let out = run(&src, AVATAR).await.unwrap();
        assert!(out.bytes == src);
        assert_eq!((out.width, out.height), (1080, 1920));
    }

    #[tokio::test]
    async fn bloated_or_oversized_webp_is_reencoded() {
        let grain = RgbImage::from_fn(1080, 1920, |x, y| {
            let n = (x.wrapping_mul(2654435761) ^ y.wrapping_mul(2246822519)).wrapping_mul(3266489917) >> 24;
            Rgb([n as u8, (x / 5) as u8, (y / 8) as u8])
        });
        let bloated = webp::Encoder::from_rgb(&grain, 1080, 1920).encode(100.0).to_vec();
        assert!(pass_through(&bloated, AVATAR).is_none());
        let out = run(&bloated, AVATAR).await.unwrap();
        assert!(out.bytes.len() < bloated.len());
        let wide = webp::Encoder::from_rgb(&photo(2000, 1000), 2000, 1000).encode(60.0).to_vec();
        let out = run(&wide, PFP).await.unwrap();
        assert_eq!((out.width, out.height), (512, 256));
    }

    #[tokio::test]
    async fn exif_rotation_is_baked_in_and_stripped() {
        let plain = jpeg(&photo(300, 200), 90);
        // Minimal EXIF block: orientation 6, "rotate 90 degrees clockwise to display".
        let tiff: &[u8] = b"II*\x00\x08\x00\x00\x00\x01\x00\x12\x01\x03\x00\x01\x00\x00\x00\x06\x00\x00\x00\x00\x00\x00\x00";
        let mut src = plain[..2].to_vec();
        src.extend_from_slice(&[0xff, 0xe1]);
        src.extend_from_slice(&((tiff.len() + 8) as u16).to_be_bytes());
        src.extend_from_slice(b"Exif\0\0");
        src.extend_from_slice(tiff);
        src.extend_from_slice(&plain[2..]);
        let out = run(&src, CHAT).await.unwrap();
        assert_eq!((out.width, out.height), (200, 300));
        assert!(!out.bytes.windows(4).any(|w| w == b"Exif" || w == b"EXIF"));
    }

    #[tokio::test]
    async fn rejects_what_is_not_a_photo() {
        assert!(run(b"not an image at all, just some text padding to pass length checks", CHAT).await.is_err());
        let mut truncated = jpeg(&photo(800, 800), 90);
        truncated.truncate(300);
        assert!(run(&truncated, CHAT).await.is_err());
        // Header claims 60000 x 60000: refused before any pixel buffer is allocated.
        let mut bomb = Vec::new();
        photo(8, 8).write_to(&mut Cursor::new(&mut bomb), ImageFormat::Png).unwrap();
        bomb[16..20].copy_from_slice(&60000u32.to_be_bytes());
        bomb[20..24].copy_from_slice(&60000u32.to_be_bytes());
        assert!(run(&bomb, CHAT).await.is_err());
    }
}
