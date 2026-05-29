#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request};

const DEFAULT_IMAGES_FOLDER: &str = "";
const DEFAULT_APP_NAME: &str = "ImageRail";
const IMAGE_EXTENSIONS: [&str; 7] = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"];

type AppResult<T> = Result<T, String>;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            choose_project_folder,
            list_projects,
            open_existing_project,
            save_project_command,
            rename_project_command,
            delete_project_record_command,
            delete_image_file_command,
            delete_track_folder_command,
            rename_track_folder_command,
            add_image_to_track_command,
            add_image_file_data_to_track_command,
            add_image_raw_file_data_to_track_command,
            add_image_url_to_track_command,
            rename_track_prefix_command,
            start_window_drag_command,
            minimize_window_command,
            toggle_maximize_window_command,
            close_window_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running ImageRail");
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn now_iso_like() -> String {
    now_millis().to_string()
}

fn app_storage_root() -> AppResult<PathBuf> {
    if cfg!(debug_assertions) {
        std::env::current_dir().map_err(|error| error.to_string())
    } else {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        exe.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法找到程序所在文件夹".to_string())
    }
}

fn project_data_dir() -> AppResult<PathBuf> {
    Ok(app_storage_root()?.join("project-data").join("projects"))
}

fn ensure_dir(path: &Path) -> AppResult<()> {
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

fn sanitize_file_name(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        if matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        ) || character.is_control()
        {
            output.push('_');
        } else {
            output.push(character);
        }
    }
    let trimmed = output.trim();
    let shortened: String = trimmed.chars().take(60).collect();
    if shortened.is_empty() {
        "project".to_string()
    } else {
        shortened
    }
}

fn sanitize_folder_name(value: &str) -> String {
    let clean = sanitize_file_name(value.trim());
    if clean.is_empty() {
        "folder".to_string()
    } else {
        clean
    }
}

fn sanitize_image_prefix(value: &str) -> String {
    let clean = sanitize_file_name(value.trim()).replace(' ', "_");
    if clean.is_empty() {
        "image".to_string()
    } else {
        clean
    }
}

fn make_project_id() -> String {
    format!("project_{}", now_millis())
}

fn get_track_letter(index: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if index < ALPHABET.len() {
        (ALPHABET[index] as char).to_string()
    } else {
        format!("T{}", index + 1)
    }
}

fn get_image_version(index: usize) -> String {
    (index + 1).to_string()
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn set_field(value: &mut Value, key: &str, field_value: Value) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_string(), field_value);
    }
}

fn normalize_track(track: &Value, index: usize) -> Value {
    let mut normalized = track.clone();
    if !normalized.is_object() {
        normalized = json!({});
    }

    let letter = if string_field(&normalized, "letter").is_empty() {
        get_track_letter(index)
    } else {
        string_field(&normalized, "letter")
    };

    if string_field(&normalized, "id").is_empty() {
        set_field(
            &mut normalized,
            "id",
            json!(format!("track_{}", now_millis())),
        );
    }
    set_field(&mut normalized, "letter", json!(letter.clone()));
    if string_field(&normalized, "prefix").is_empty() {
        set_field(&mut normalized, "prefix", json!(letter.clone()));
    }
    if string_field(&normalized, "folderName").is_empty() {
        set_field(
            &mut normalized,
            "folderName",
            json!(format!("track_{}", letter)),
        );
    }
    if string_field(&normalized, "name").is_empty() {
        set_field(&mut normalized, "name", json!(format!("轨道 {}", letter)));
    }
    if !normalized
        .get("images")
        .map(Value::is_array)
        .unwrap_or(false)
    {
        set_field(&mut normalized, "images", json!([]));
    }

    normalized
}

fn normalize_project(project: Value) -> Value {
    let mut normalized = if project.is_object() {
        project
    } else {
        json!({})
    };
    let project_id = if string_field(&normalized, "projectId").is_empty() {
        make_project_id()
    } else {
        string_field(&normalized, "projectId")
    };

    set_field(&mut normalized, "projectId", json!(project_id.clone()));
    if string_field(&normalized, "projectDataFile").is_empty() {
        set_field(
            &mut normalized,
            "projectDataFile",
            json!(format!("project_{}.json", project_id)),
        );
    }
    if string_field(&normalized, "appName").is_empty() {
        set_field(&mut normalized, "appName", json!(DEFAULT_APP_NAME));
    }
    if string_field(&normalized, "imagesFolderName").is_empty() {
        set_field(
            &mut normalized,
            "imagesFolderName",
            json!(DEFAULT_IMAGES_FOLDER),
        );
    }
    if normalized.get("version").is_none() {
        set_field(&mut normalized, "version", json!(1));
    }
    if string_field(&normalized, "updatedAt").is_empty() {
        set_field(&mut normalized, "updatedAt", json!(now_iso_like()));
    }

    let tracks = normalized
        .get("tracks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(index, track)| normalize_track(track, index))
        .collect::<Vec<_>>();
    set_field(&mut normalized, "tracks", json!(tracks));

    normalized
}

fn create_empty_project() -> Value {
    let project_id = make_project_id();
    json!({
        "projectId": project_id,
        "projectDataFile": format!("project_{}.json", project_id),
        "appName": DEFAULT_APP_NAME,
        "projectName": "",
        "imagesFolderName": DEFAULT_IMAGES_FOLDER,
        "version": 1,
        "updatedAt": now_iso_like(),
        "tracks": []
    })
}

fn get_project_data_path(project: &Value) -> AppResult<PathBuf> {
    let data_file = string_field(project, "projectDataFile");
    let safe_name = Path::new(&data_file)
        .file_name()
        .and_then(|item| item.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "项目数据文件名不正确".to_string())?;
    Ok(project_data_dir()?.join(safe_name))
}

fn project_images_dir(project_path: &str, project: &Value) -> PathBuf {
    let folder_name = string_field(project, "imagesFolderName");
    if folder_name.is_empty() {
        Path::new(project_path).to_path_buf()
    } else {
        Path::new(project_path).join(folder_name)
    }
}

fn track_folder_name(track: &Value, index: usize) -> String {
    let folder_name = string_field(track, "folderName");
    if folder_name.is_empty() {
        format!(
            "track_{}",
            string_field(track, "letter").if_empty(get_track_letter(index))
        )
    } else {
        folder_name
    }
}

trait IfEmpty {
    fn if_empty(self, fallback: String) -> String;
}

impl IfEmpty for String {
    fn if_empty(self, fallback: String) -> String {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}

fn save_project(project_path: &str, project: Value) -> AppResult<Value> {
    let mut project_to_save = normalize_project(project);
    set_field(
        &mut project_to_save,
        "projectFolderPath",
        json!(project_path),
    );
    set_field(&mut project_to_save, "updatedAt", json!(now_iso_like()));

    ensure_dir(&project_images_dir(project_path, &project_to_save))?;
    ensure_dir(&project_data_dir()?)?;

    let path = get_project_data_path(&project_to_save)?;
    let data = serde_json::to_string_pretty(&project_to_save).map_err(|error| error.to_string())?;
    fs::write(path, data).map_err(|error| error.to_string())?;

    Ok(project_to_save)
}

fn read_saved_project_records() -> AppResult<Vec<(String, Value)>> {
    let dir = project_data_dir()?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut records = vec![];
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|item| item.to_str()) != Some("json") {
            continue;
        }

        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(mut project) = serde_json::from_str::<Value>(&raw) {
                project = normalize_project(project);
                if let Some(file_name) = path.file_name().and_then(|item| item.to_str()) {
                    set_field(&mut project, "projectDataFile", json!(file_name));
                }
                let project_path = string_field(&project, "projectFolderPath");
                if !project_path.is_empty() {
                    records.push((project_path, project));
                }
            }
        }
    }
    Ok(records)
}

fn read_project_from_data_file(project_data_file: &str) -> AppResult<Value> {
    let safe_name = Path::new(project_data_file)
        .file_name()
        .and_then(|item| item.to_str())
        .ok_or_else(|| "Project data file name is invalid".to_string())?;
    let raw = fs::read_to_string(project_data_dir()?.join(safe_name))
        .map_err(|error| error.to_string())?;
    let mut project =
        normalize_project(serde_json::from_str(&raw).map_err(|error| error.to_string())?);
    set_field(&mut project, "projectDataFile", json!(safe_name));
    Ok(project)
}

fn image_extension_from_name(file_name: &str) -> String {
    Path::new(file_name)
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| format!(".{}", item.to_lowercase()))
        .filter(|extension| IMAGE_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or_default()
}

fn image_extension_from_mime(mime_type: &str) -> String {
    match mime_type.to_lowercase().as_str() {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/bmp" => ".bmp",
        "image/avif" => ".avif",
        _ => "",
    }
    .to_string()
}

fn image_extension_from_url(url: &str) -> String {
    let clean_url = url.split('?').next().unwrap_or(url);
    image_extension_from_name(clean_url)
}

fn header_value(request: &Request<'_>, name: &str) -> AppResult<String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| format!("Missing header: {}", name))?
        .to_str()
        .map(|value| value.to_string())
        .map_err(|error| error.to_string())
}

fn percent_decode(value: &str) -> AppResult<String> {
    let mut bytes = Vec::with_capacity(value.len());
    let mut index = 0;
    let raw = value.as_bytes();

    while index < raw.len() {
        if raw[index] == b'%' {
            if index + 2 >= raw.len() {
                return Err("Invalid encoded text".to_string());
            }

            let hex = std::str::from_utf8(&raw[index + 1..index + 3])
                .map_err(|error| error.to_string())?;
            let decoded = u8::from_str_radix(hex, 16).map_err(|error| error.to_string())?;
            bytes.push(decoded);
            index += 3;
        } else {
            bytes.push(raw[index]);
            index += 1;
        }
    }

    String::from_utf8(bytes).map_err(|error| error.to_string())
}

fn assert_image_extension(extension: &str) -> AppResult<()> {
    if IMAGE_EXTENSIONS.contains(&extension) {
        Ok(())
    } else {
        Err("只能拖入图片文件：png、jpg、jpeg、webp、gif、bmp、avif".to_string())
    }
}

fn find_next_image_name(
    track_dir: &Path,
    track: &Value,
    track_prefix: &str,
    extension: &str,
) -> AppResult<(String, String, PathBuf)> {
    let images = track
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut index = 0;

    loop {
        let version = get_image_version(index);
        let file_name = format!("{}_{}{}", track_prefix, version, extension);
        let destination = track_dir.join(&file_name);
        let used = images.iter().any(|image| {
            string_field(image, "fileName") == file_name
                || string_field(image, "version") == version
        });

        if !used && !destination.exists() {
            return Ok((version, file_name, destination));
        }
        index += 1;
    }
}

fn relative_path(from: &str, to: &Path) -> String {
    to.strip_prefix(from)
        .unwrap_or(to)
        .to_string_lossy()
        .replace('\\', "/")
}

fn add_image_with_writer<F>(
    project_path: &str,
    project: Value,
    track_id: &str,
    extension: &str,
    writer: F,
) -> AppResult<Value>
where
    F: FnOnce(&Path) -> AppResult<()>,
{
    assert_image_extension(extension)?;
    let mut working_project = normalize_project(project);
    let images_dir = project_images_dir(project_path, &working_project);
    let tracks = working_project
        .get_mut("tracks")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "项目轨道数据不正确".to_string())?;

    let track_index = tracks
        .iter()
        .position(|track| string_field(track, "id") == track_id)
        .ok_or_else(|| "没有找到目标轨道".to_string())?;

    let track = &mut tracks[track_index];
    let track_prefix = sanitize_image_prefix(
        &string_field(track, "prefix").if_empty(get_track_letter(track_index)),
    );
    let track_dir = images_dir.join(track_folder_name(track, track_index));
    ensure_dir(&track_dir)?;

    let (version, file_name, destination) =
        find_next_image_name(&track_dir, track, &track_prefix, extension)?;
    writer(&destination)?;

    let image_record = json!({
        "id": format!("img_{}", now_millis()),
        "fileName": file_name,
        "version": version,
        "relativePath": relative_path(project_path, &destination),
        "note": "",
        "status": "pending",
        "createdAt": now_iso_like()
    });

    track
        .get_mut("images")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "轨道图片数据不正确".to_string())?
        .push(image_record.clone());

    let saved_project = save_project(project_path, working_project)?;
    Ok(json!({ "projectPath": project_path, "project": saved_project, "image": image_record }))
}

#[tauri::command]
fn choose_project_folder() -> AppResult<Option<Value>> {
    let Some(project_folder) = rfd::FileDialog::new()
        .set_title("选择文件夹创建 ImageRail 项目")
        .pick_folder()
    else {
        return Ok(None);
    };

    let project_path = project_folder.to_string_lossy().to_string();
    let mut project = create_empty_project();
    let project_name = project_folder
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("ImageRail Project");
    set_field(&mut project, "projectName", json!(project_name));
    let saved_project = save_project(&project_path, project)?;
    Ok(Some(
        json!({ "projectPath": project_path, "project": saved_project }),
    ))
}

#[tauri::command]
fn list_projects() -> AppResult<Vec<Value>> {
    let mut records = read_saved_project_records()?;
    records.sort_by(|a, b| string_field(&b.1, "updatedAt").cmp(&string_field(&a.1, "updatedAt")));

    Ok(records
        .into_iter()
        .map(|(project_path, project)| {
            let tracks = project
                .get("tracks")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let image_count: usize = tracks
                .iter()
                .map(|track| {
                    track
                        .get("images")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or(0)
                })
                .sum();

            json!({
                "projectPath": project_path,
                "projectId": string_field(&project, "projectId"),
                "projectDataFile": string_field(&project, "projectDataFile"),
                "projectName": string_field(&project, "projectName"),
                "imagesFolderName": string_field(&project, "imagesFolderName"),
                "trackCount": tracks.len(),
                "imageCount": image_count,
                "updatedAt": string_field(&project, "updatedAt")
            })
        })
        .collect())
}

#[tauri::command]
fn open_existing_project(project_path: String, project_data_file: String) -> AppResult<Value> {
    let project = read_project_from_data_file(&project_data_file)?;
    ensure_dir(&project_images_dir(&project_path, &project))?;
    Ok(json!({ "projectPath": project_path, "project": project }))
}

#[tauri::command]
fn save_project_command(project_path: String, project: Value) -> AppResult<Value> {
    let saved_project = save_project(&project_path, project)?;
    Ok(json!({ "projectPath": project_path, "project": saved_project }))
}

#[tauri::command]
fn rename_project_command(
    project_path: String,
    project: Value,
    new_project_name: String,
) -> AppResult<Value> {
    let clean_name = new_project_name.trim();
    if clean_name.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let mut working_project = normalize_project(project);
    set_field(&mut working_project, "projectName", json!(clean_name));
    let saved_project = save_project(&project_path, working_project)?;
    Ok(json!({ "projectPath": project_path, "project": saved_project }))
}

#[tauri::command]
fn rename_track_folder_command(
    project_path: String,
    project: Value,
    track_id: String,
    new_track_name: String,
) -> AppResult<Value> {
    let mut working_project = normalize_project(project);
    let images_folder_name = string_field(&working_project, "imagesFolderName");
    let images_dir = Path::new(&project_path).join(&images_folder_name);
    ensure_dir(&images_dir)?;

    let tracks = working_project
        .get_mut("tracks")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "项目轨道数据不正确".to_string())?;
    let track_index = tracks
        .iter()
        .position(|track| string_field(track, "id") == track_id)
        .ok_or_else(|| "Track not found".to_string())?;
    let track = &mut tracks[track_index];
    let clean_name = new_track_name.trim();
    let clean_folder_name = sanitize_folder_name(clean_name);
    let old_folder_name = track_folder_name(track, track_index);
    let old_folder_path = images_dir.join(&old_folder_name);
    let new_folder_path = images_dir.join(&clean_folder_name);

    if old_folder_path != new_folder_path && new_folder_path.exists() {
        return Err(format!("Already exists: {}", clean_folder_name));
    }
    if old_folder_path.exists() && old_folder_path != new_folder_path {
        fs::rename(&old_folder_path, &new_folder_path).map_err(|error| error.to_string())?;
    } else {
        ensure_dir(&new_folder_path)?;
    }

    set_field(
        track,
        "name",
        json!(if clean_name.is_empty() {
            clean_folder_name.clone()
        } else {
            clean_name.to_string()
        }),
    );
    set_field(track, "folderName", json!(clean_folder_name.clone()));
    if let Some(images) = track.get_mut("images").and_then(Value::as_array_mut) {
        for image in images {
            let file_path = format!("{}/{}", clean_folder_name, string_field(image, "fileName"));
            let relative = if images_folder_name.is_empty() {
                file_path
            } else {
                format!("{}/{}", images_folder_name, file_path)
            };
            set_field(image, "relativePath", json!(relative));
        }
    }

    let saved_project = save_project(&project_path, working_project)?;
    Ok(json!({ "projectPath": project_path, "project": saved_project }))
}

#[tauri::command]
fn delete_project_record_command(project_data_file: String) -> AppResult<Value> {
    if let Some(file_name) = Path::new(&project_data_file)
        .file_name()
        .and_then(|item| item.to_str())
    {
        let path = project_data_dir()?.join(file_name);
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(json!({}))
}

fn project_scoped_file_path(project_path: &str, relative_path: &str) -> AppResult<PathBuf> {
    let project_root = Path::new(project_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let relative = Path::new(relative_path);

    if relative.is_absolute() {
        return Err("图片路径不能指向项目文件夹外部".to_string());
    }

    let image_path = project_root.join(relative);
    if image_path.exists() {
        let canonical_image_path = image_path
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !canonical_image_path.starts_with(&project_root) {
            return Err("为了避免误删，不能删除项目文件夹外部的图片".to_string());
        }
        return Ok(canonical_image_path);
    }

    Ok(image_path)
}

#[tauri::command]
fn delete_track_folder_command(
    project_path: String,
    project: Value,
    track_id: String,
) -> AppResult<Value> {
    let mut working_project = normalize_project(project);
    let project_root = Path::new(&project_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let images_dir = project_images_dir(&project_path, &working_project);
    let tracks = working_project
        .get_mut("tracks")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "项目轨道数据不正确".to_string())?;
    let track_index = tracks
        .iter()
        .position(|track| string_field(track, "id") == track_id)
        .ok_or_else(|| "没有找到目标轨道".to_string())?;
    let folder_name = track_folder_name(&tracks[track_index], track_index);
    let track_dir = images_dir.join(folder_name);

    if track_dir.exists() {
        let canonical_track_dir = track_dir
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !canonical_track_dir.starts_with(&project_root) || canonical_track_dir == project_root {
            return Err("为了避免误删，不能删除项目文件夹本身或项目外部文件夹".to_string());
        }
        if !canonical_track_dir.is_dir() {
            return Err("轨道路径不是文件夹，已停止删除".to_string());
        }
        fs::remove_dir_all(&canonical_track_dir).map_err(|error| error.to_string())?;
    }

    tracks.remove(track_index);
    let saved_project = save_project(&project_path, working_project)?;
    Ok(json!({ "projectPath": project_path, "project": saved_project }))
}

#[tauri::command]
fn delete_image_file_command(
    project_path: String,
    project: Value,
    track_id: String,
    image_id: String,
) -> AppResult<Value> {
    let mut working_project = normalize_project(project);
    let tracks = working_project
        .get_mut("tracks")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "项目轨道数据不正确".to_string())?;
    let track = tracks
        .iter_mut()
        .find(|track| string_field(track, "id") == track_id)
        .ok_or_else(|| "没有找到目标轨道".to_string())?;
    let images = track
        .get_mut("images")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "轨道图片数据不正确".to_string())?;
    let image_index = images
        .iter()
        .position(|image| string_field(image, "id") == image_id)
        .ok_or_else(|| "没有找到目标图片".to_string())?;
    let image = images[image_index].clone();
    let relative_path = string_field(&image, "relativePath");

    if !relative_path.is_empty() {
        let image_path = project_scoped_file_path(&project_path, &relative_path)?;
        if image_path.exists() {
            fs::remove_file(&image_path).map_err(|error| error.to_string())?;
        }
    }

    images.remove(image_index);
    let saved_project = save_project(&project_path, working_project)?;
    Ok(json!({ "projectPath": project_path, "project": saved_project }))
}

#[tauri::command]
fn start_window_drag_command(window: tauri::Window) -> AppResult<()> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize_window_command(window: tauri::Window) -> AppResult<()> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_window_command(window: tauri::Window) -> AppResult<()> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn close_window_command(window: tauri::Window) -> AppResult<()> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn add_image_to_track_command(
    project_path: String,
    project: Value,
    track_id: String,
    source_path: String,
) -> AppResult<Value> {
    let extension = image_extension_from_name(&source_path);
    add_image_with_writer(
        &project_path,
        project,
        &track_id,
        &extension,
        |destination| {
            fs::copy(&source_path, destination)
                .map(|_| ())
                .map_err(|error| error.to_string())
        },
    )
}

#[tauri::command]
fn add_image_file_data_to_track_command(
    project_path: String,
    project: Value,
    track_id: String,
    file_name: String,
    mime_type: String,
    file_data: Vec<u8>,
) -> AppResult<Value> {
    let extension =
        image_extension_from_name(&file_name).if_empty(image_extension_from_mime(&mime_type));
    add_image_with_writer(
        &project_path,
        project,
        &track_id,
        &extension,
        |destination| fs::write(destination, &file_data).map_err(|error| error.to_string()),
    )
}

#[tauri::command]
fn add_image_raw_file_data_to_track_command(request: Request<'_>) -> AppResult<Value> {
    let project_path = percent_decode(&header_value(&request, "x-project-path")?)?;
    let project_data_file = percent_decode(&header_value(&request, "x-project-data-file")?)?;
    let track_id = percent_decode(&header_value(&request, "x-track-id")?)?;
    let file_name = percent_decode(&header_value(&request, "x-file-name")?)?;
    let mime_type = header_value(&request, "x-mime-type").unwrap_or_default();
    let project = read_project_from_data_file(&project_data_file)?;
    let extension =
        image_extension_from_name(&file_name).if_empty(image_extension_from_mime(&mime_type));
    let file_data = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err("Image data must be sent as raw bytes".to_string()),
    };

    add_image_with_writer(
        &project_path,
        project,
        &track_id,
        &extension,
        |destination| fs::write(destination, &file_data).map_err(|error| error.to_string()),
    )
}

#[tauri::command]
fn add_image_url_to_track_command(
    project_path: String,
    project: Value,
    track_id: String,
    url: String,
) -> AppResult<Value> {
    let response = ureq::get(&url).call().map_err(|error| error.to_string())?;
    let content_type = response.header("content-type").unwrap_or("");
    let extension = image_extension_from_mime(content_type.split(';').next().unwrap_or(""))
        .if_empty(image_extension_from_url(&url));
    let mut bytes = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;

    add_image_with_writer(
        &project_path,
        project,
        &track_id,
        &extension,
        |destination| fs::write(destination, &bytes).map_err(|error| error.to_string()),
    )
}

#[tauri::command]
fn rename_track_prefix_command(
    project_path: String,
    project: Value,
    track_id: String,
    new_prefix: String,
) -> AppResult<Value> {
    let mut working_project = normalize_project(project);
    let tracks = working_project
        .get_mut("tracks")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "项目轨道数据不正确".to_string())?;
    let track = tracks
        .iter_mut()
        .find(|track| string_field(track, "id") == track_id)
        .ok_or_else(|| "没有找到目标轨道".to_string())?;
    let clean_prefix = sanitize_image_prefix(&new_prefix);
    let images = track
        .get_mut("images")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "轨道图片数据不正确".to_string())?;

    let mut jobs = vec![];
    for (image_index, image) in images.iter().enumerate() {
        let old_relative = string_field(image, "relativePath");
        let old_absolute = Path::new(&project_path).join(&old_relative);
        let extension = image_extension_from_name(&string_field(image, "fileName"))
            .if_empty(".png".to_string());
        let new_version = get_image_version(image_index);
        let new_file_name = format!("{}_{}{}", clean_prefix, new_version, extension);
        let parent = Path::new(&old_relative).parent().unwrap_or(Path::new(""));
        let new_relative = parent
            .join(&new_file_name)
            .to_string_lossy()
            .replace('\\', "/");
        let new_absolute = Path::new(&project_path).join(&new_relative);

        if old_absolute != new_absolute && new_absolute.exists() {
            return Err(format!("已经存在同名文件：{}", new_file_name));
        }

        jobs.push((
            image_index,
            old_absolute,
            new_absolute,
            new_file_name,
            new_relative,
            new_version,
        ));
    }

    for (image_index, old_absolute, new_absolute, new_file_name, new_relative, new_version) in jobs
    {
        if old_absolute != new_absolute {
            fs::rename(old_absolute, new_absolute).map_err(|error| error.to_string())?;
        }
        if let Some(image) = images.get_mut(image_index) {
            set_field(image, "fileName", json!(new_file_name));
            set_field(image, "relativePath", json!(new_relative));
            set_field(image, "version", json!(new_version));
        }
    }

    set_field(track, "prefix", json!(clean_prefix));
    let saved_project = save_project(&project_path, working_project)?;
    Ok(json!({ "projectPath": project_path, "project": saved_project }))
}
