# ImageRail / 画轨

ImageRail 是一个轻量图片版本管理桌面工具，用来把同一创作方向下的图片按轨道整理、命名、备注和对比。

## 下载使用

请在 GitHub Releases 页面下载已打包版本：

https://github.com/Star-Fish-C/Image-rail/releases

下载 `.exe` 后直接运行即可。普通用户不需要安装 Node.js、Rust 或 Tauri。

## 主要功能

- 创建和打开 ImageRail 项目。
- 在项目里创建多条图片轨道。
- 将图片拖入轨道，自动复制到项目图片文件夹。
- 自动命名图片，例如 `A_1.png`、`A_2.png`。
- 显示缩略图、文件名、版本号、备注和状态。
- 点击图片放大预览。
- 固定一张图片后，与另一张图片上下对比。
- 重命名项目显示名、图片总文件夹、轨道文件夹和同轨道图片名前缀。
- 删除图片记录或轨道记录时，不直接删除硬盘上的原文件。

## 文件结构

选择项目文件夹后，默认会在其中创建图片总文件夹：

```text
项目文件夹/
└─ images/
   ├─ track_A/
   │  ├─ A_1.png
   │  └─ A_2.png
   └─ track_B/
      └─ B_1.png
```

项目列表和项目数据保存在应用目录下的 `project-data` 文件夹中，不直接放进你选择的项目文件夹。

## 开发命令

本项目现在使用 Tauri + HTML + CSS + JavaScript。

```powershell
npm.cmd install
npm.cmd start
```

打包 Windows 程序：

```powershell
npm.cmd run dist
```

打包结果在：

```text
src-tauri/target/release/bundle/
```

## 当前版本

当前版本是 Tauri 版 MVP，保留基础图片轨道管理、拖拽导入、自动命名、备注、状态、预览、重命名、轨道删除和双图对比。
