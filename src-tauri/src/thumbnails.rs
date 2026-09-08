use crate::{project_scoped_file_path, AppResult};
use image::{DynamicImage, GenericImageView, ImageReader};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::SystemTime,
};
use tauri::Manager;

const VERSION: &str = "png512-v1";
const CACHE_LIMIT: u64 = 512 * 1024 * 1024;
const INPUT_LIMIT: u64 = 100 * 1024 * 1024;
const MAX_SIDE: u32 = 8192;

pub struct ThumbnailCache {
    slots: Arc<tokio::sync::Semaphore>,
    locks: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
    leases: Arc<Mutex<HashMap<String, String>>>,
    last_cleanup: Mutex<Option<std::time::Instant>>,
}

impl Default for ThumbnailCache {
    fn default() -> Self {
        Self {
            slots: Arc::new(tokio::sync::Semaphore::new(2)),
            locks: Mutex::new(HashMap::new()),
            leases: Default::default(),
            last_cleanup: Mutex::new(None),
        }
    }
}

fn fingerprint(source: &Path) -> AppResult<String> {
    let stat = fs::metadata(source).map_err(|e| e.to_string())?;
    if !stat.is_file() || stat.len() > INPUT_LIMIT {
        return Err("图片不是文件或超过 100 MB".into());
    }
    let modified = stat
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(format!(
        "{:x}",
        Sha256::digest(format!(
            "{VERSION}|{}|{}|{modified}",
            source.display(),
            stat.len()
        ))
    ))
}

fn decode(source: &Path) -> AppResult<DynamicImage> {
    let reader = ImageReader::open(source)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if reader.format() == Some(image::ImageFormat::Avif) {
        // libaom's build-time limits reject oversized AV1 frames before allocation.
        let bytes = fs::read(source).map_err(|e| e.to_string())?;
        let decoded = avif_decode::Decoder::from_avif(&bytes)
            .and_then(|d| d.to_image())
            .map_err(|e| e.to_string())?;
        macro_rules! convert {
            ($img:expr, $pixel:expr) => {{
                let img = $img;
                let (width, height) = (img.width() as u32, img.height() as u32);
                if width > MAX_SIDE || height > MAX_SIDE { return Err("图片尺寸超过 8192 像素解码上限".into()); }
                let data: Vec<u8> = img.pixels().flat_map($pixel).collect();
                DynamicImage::ImageRgba8(image::RgbaImage::from_raw(width, height, data).ok_or("AVIF 像素数据不正确")?)
            }};
        }
        return Ok(match decoded {
            avif_decode::Image::Rgb8(i) => convert!(i, |p| [p.r, p.g, p.b, 255]),
            avif_decode::Image::Rgba8(i) => convert!(i, |p| [p.r, p.g, p.b, p.a]),
            avif_decode::Image::Rgb16(i) => convert!(i, |p| [
                (p.r >> 8) as u8,
                (p.g >> 8) as u8,
                (p.b >> 8) as u8,
                255
            ]),
            avif_decode::Image::Rgba16(i) => convert!(i, |p| [
                (p.r >> 8) as u8,
                (p.g >> 8) as u8,
                (p.b >> 8) as u8,
                (p.a >> 8) as u8
            ]),
            avif_decode::Image::Gray8(i) => convert!(i, |p| [p.value(), p.value(), p.value(), 255]),
            avif_decode::Image::Gray16(i) => convert!(i, |p| [
                (p.value() >> 8) as u8,
                (p.value() >> 8) as u8,
                (p.value() >> 8) as u8,
                255
            ]),
        });
    }
    let mut reader = reader;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| format!("无法生成缩略图（尺寸上限 8192，内存预算 512 MB）：{e}"))
}

fn generate(source: &Path, directory: &Path, key: &str) -> AppResult<Value> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let output = directory.join(format!("{key}.png"));
    let metadata = directory.join(format!("{key}.json"));
    if output.is_file() {
        if let Ok(bytes) = fs::read(&metadata) {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                let _ = fs::OpenOptions::new()
                    .write(true)
                    .open(&output)
                    .and_then(|f| {
                        f.set_times(fs::FileTimes::new().set_modified(SystemTime::now()))
                    });
                return Ok(value);
            }
        }
    }
    let image = decode(source)?;
    let (width, height) = image.dimensions();
    let thumbnail = if width <= 512 && height <= 512 {
        image
    } else {
        image.thumbnail(512, 512)
    };
    let temp = directory.join(format!("{key}.{}.tmp", std::process::id()));
    let result = (|| {
        thumbnail
            .save_with_format(&temp, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        if fingerprint(source)? != key {
            return Err("图片在生成缩略图期间发生变化，请重试".into());
        }
        if output.exists() {
            fs::remove_file(&output).map_err(|e| e.to_string())?;
        }
        fs::rename(&temp, &output).map_err(|e| e.to_string())?;
        let value =
            json!({ "cachePath": output, "width": width, "height": height, "fingerprint": key });
        let meta_temp = temp.with_extension("json.tmp");
        fs::write(&meta_temp, serde_json::to_vec(&value).unwrap()).map_err(|e| e.to_string())?;
        if metadata.exists() {
            fs::remove_file(&metadata).map_err(|e| e.to_string())?;
        }
        fs::rename(meta_temp, metadata).map_err(|e| e.to_string())?;
        Ok(value)
    })();
    let _ = fs::remove_file(temp);
    result
}

fn cleanup(directory: &Path, protected: &HashSet<String>, limit: u64) -> AppResult<()> {
    let mut files = vec![];
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("png") {
            continue;
        }
        let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
        files.push((
            meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            meta.len(),
            path,
        ));
    }
    files.sort_by_key(|item| item.0);
    let mut total: u64 = files.iter().map(|item| item.1).sum();
    for (_, size, path) in files {
        if total <= limit {
            break;
        }
        if protected.contains(path.file_stem().and_then(|v| v.to_str()).unwrap_or("")) {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            total -= size;
            let _ = fs::remove_file(path.with_extension("json"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_image_thumbnail(
    app: tauri::AppHandle,
    cache: tauri::State<'_, ThumbnailCache>,
    project_path: String,
    relative_path: String,
    lease_id: String,
) -> AppResult<Value> {
    let directory: PathBuf = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    let source = tauri::async_runtime::spawn_blocking(move || {
        project_scoped_file_path(&project_path, &relative_path)
    })
    .await
    .map_err(|e| e.to_string())??;
    request(&cache, directory, source, lease_id).await
}

async fn request(
    cache: &ThumbnailCache,
    directory: PathBuf,
    source: PathBuf,
    lease_id: String,
) -> AppResult<Value> {
    let key_source = source.clone();
    let key = tauri::async_runtime::spawn_blocking(move || fingerprint(&key_source))
        .await
        .map_err(|e| e.to_string())??;
    let lock = {
        let mut locks = cache.locks.lock().map_err(|e| e.to_string())?;
        locks.retain(|_, lock| lock.strong_count() > 0);
        let lock = locks
            .get(&key)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| Arc::new(tokio::sync::Mutex::new(())));
        locks.insert(key.clone(), Arc::downgrade(&lock));
        lock
    };
    let _guard = lock.lock().await;
    let _permit = cache.slots.acquire().await.map_err(|e| e.to_string())?;
    cache
        .leases
        .lock()
        .map_err(|e| e.to_string())?
        .insert(lease_id.clone(), key.clone());
    let generation_directory = directory.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        generate(&source, &generation_directory, &key)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|value| value);
    if result.is_err() {
        cache
            .leases
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&lease_id);
    }
    let should_clean = {
        let mut last = cache.last_cleanup.lock().map_err(|e| e.to_string())?;
        if last
            .map(|time| time.elapsed().as_secs() >= 30)
            .unwrap_or(true)
        {
            *last = Some(std::time::Instant::now());
            true
        } else {
            false
        }
    };
    if should_clean {
        let leases = cache.leases.clone();
        tauri::async_runtime::spawn_blocking(move || {
            // Protect both readers and generators while removing old files.
            if let Ok(leases) = leases.lock() {
                let protected = leases.values().cloned().collect();
                let _ = cleanup(&directory, &protected, CACHE_LIMIT);
            }
        });
    }
    result
}

#[tauri::command]
pub fn release_image_thumbnails(cache: tauri::State<'_, ThumbnailCache>, lease_ids: Vec<String>) {
    if let Ok(mut leases) = cache.leases.lock() {
        for id in lease_ids {
            leases.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_hit_invalidation_alpha_and_no_upscale() {
        let root = std::env::temp_dir().join(crate::make_unique_id("thumb_test"));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        image::RgbaImage::from_pixel(32, 16, image::Rgba([12, 34, 56, 90]))
            .save(&source)
            .unwrap();
        let key = fingerprint(&source).unwrap();
        let cache = root.join("cache");
        let first = generate(&source, &cache, &key).unwrap();
        assert_eq!(first, generate(&source, &cache, &key).unwrap());
        let decoded = image::open(first["cachePath"].as_str().unwrap())
            .unwrap()
            .to_rgba8();
        assert_eq!(decoded.dimensions(), (32, 16));
        assert_eq!(decoded.get_pixel(0, 0).0[3], 90);
        image::RgbImage::new(1024, 256).save(&source).unwrap();
        let new_key = fingerprint(&source).unwrap();
        assert_ne!(key, new_key);
        let next = generate(&source, &cache, &new_key).unwrap();
        assert_eq!(
            image::image_dimensions(next["cachePath"].as_str().unwrap()).unwrap(),
            (512, 128)
        );
        cleanup(&cache, &HashSet::from([new_key.clone()]), 0).unwrap();
        assert!(!cache.join(format!("{key}.png")).exists());
        assert!(cache.join(format!("{new_key}.png")).exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn supported_formats_decode_and_gif_uses_first_frame() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
        for extension in ["png", "jpg", "jpeg", "webp", "bmp", "gif", "avif"] {
            let decoded = decode(&fixtures.join(format!("sample.{extension}"))).unwrap();
            assert_eq!(decoded.dimensions(), (64, 32), "{extension}");
            if extension == "gif" {
                assert_eq!(decoded.to_rgb8().get_pixel(0, 0).0, [255, 0, 0]);
            }
        }
    }

    #[test]
    fn concurrent_identical_requests_share_one_complete_cache_entry() {
        let root = std::env::temp_dir().join(crate::make_unique_id("thumb_concurrent"));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        image::RgbImage::new(1500, 1000).save(&source).unwrap();
        let cache = Arc::new(ThumbnailCache::default());
        let directory = root.join("cache");
        let jobs: Vec<_> = (0..8)
            .map(|i| {
                let (cache, directory, source) = (cache.clone(), directory.clone(), source.clone());
                tauri::async_runtime::spawn(async move {
                    request(&cache, directory, source, i.to_string()).await
                })
            })
            .collect();
        let values: Vec<_> = jobs
            .into_iter()
            .map(|job| tauri::async_runtime::block_on(job).unwrap().unwrap())
            .collect();
        assert!(values.iter().all(|value| value == &values[0]));
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
        assert_eq!(cache.leases.lock().unwrap().len(), 8);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_images_exceeding_decode_dimension_limits() {
        let avif = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/oversized.avif");
        assert!(decode(&avif).is_err());
        let source =
            std::env::temp_dir().join(format!("{}.png", crate::make_unique_id("oversized")));
        image::RgbImage::new(9000, 1).save(&source).unwrap();
        assert!(decode(&source).is_err());
        fs::remove_file(source).unwrap();
    }

    #[test]
    fn rejects_corrupt_input_and_unwritable_cache() {
        let root = std::env::temp_dir().join(crate::make_unique_id("thumb_error"));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("bad.png");
        fs::write(&source, b"not an image").unwrap();
        assert!(generate(&source, &root.join("cache"), &fingerprint(&source).unwrap()).is_err());
        assert!(generate(&source, &source, &fingerprint(&source).unwrap()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
