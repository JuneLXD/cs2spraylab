//! Compiles the window (ui/app.slint) and, for Windows, the programs' resources: the icon Explorer and the taskbar show,
//! version information, and a manifest (per-monitor DPI awareness, Windows 10/11, themed dialogs). The resources are
//! compiled with `zig rc`, which comes with the Zig that cargo-zigbuild uses; without it the programs build without them.

#[path = "src/icon.rs"]
#[allow(dead_code)]
mod icon;

use std::path::{Path, PathBuf};
use std::process::Command;

const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
"#;

fn main() {
    // The fonts (ui/fonts, SprayLab's Rajdhani and Barlow) go into the program, so it looks the same on any PC.
    let config = slint_build::CompilerConfiguration::new()
        .with_style("fluent-dark".into())
        .embed_resources(slint_build::EmbedResourcesKind::EmbedFiles);
    slint_build::compile_with_config("ui/app.slint", config).expect("ui/app.slint compiles");
    println!("cargo:rerun-if-changed=src/icon.rs");
    println!("cargo:rerun-if-changed=ui");
    println!("cargo:rerun-if-env-changed=ZIG");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out = PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets OUT_DIR"));
        match resources(&out) {
            Ok(res) => println!("cargo:rustc-link-arg-bins={}", res.display()),
            Err(error) => println!("cargo:warning=Building without the icon and manifest resources: {error}"),
        }
    }
}

/// An .ico with PNG images at the sizes Windows asks for.
fn ico(sizes: &[u32]) -> Vec<u8> {
    let images: Vec<Vec<u8>> = sizes
        .iter()
        .map(|&size| {
            let mut png = Vec::new();
            let mut encoder = png::Encoder::new(&mut png, size, size);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("PNG header");
            writer.write_image_data(&icon::rgba(size, icon::ON)).expect("PNG data");
            writer.finish().expect("PNG end");
            png
        })
        .collect();
    let mut file = Vec::new();
    file.extend(0u16.to_le_bytes());
    file.extend(1u16.to_le_bytes());
    file.extend((sizes.len() as u16).to_le_bytes());
    let mut offset = 6 + 16 * sizes.len() as u32;
    for (&size, image) in sizes.iter().zip(&images) {
        let side = if size >= 256 { 0 } else { size as u8 };
        file.extend([side, side, 0, 0]);
        file.extend(1u16.to_le_bytes());
        file.extend(32u16.to_le_bytes());
        file.extend((image.len() as u32).to_le_bytes());
        file.extend(offset.to_le_bytes());
        offset += image.len() as u32;
    }
    for image in images {
        file.extend(image);
    }
    file
}

fn resources(out: &Path) -> Result<PathBuf, String> {
    let write = |name: &str, bytes: &[u8]| std::fs::write(out.join(name), bytes).map_err(|error| format!("cannot write {name}: {error}"));
    write("app.ico", &ico(&[16, 20, 24, 32, 40, 48, 64, 256]))?;
    write("app.manifest", MANIFEST.as_bytes())?;
    let version = std::env::var("CARGO_PKG_VERSION").expect("cargo sets the version");
    let numbers: Vec<&str> = version.split(['.', '-']).take(3).collect();
    let numeric = format!("{},0", numbers.join(","));
    let rc = format!(
        "1 ICON \"app.ico\"\n\
         1 24 \"app.manifest\"\n\
         1 VERSIONINFO\n\
         FILEVERSION {numeric}\n\
         PRODUCTVERSION {numeric}\n\
         FILEOS 0x40004\n\
         FILETYPE 0x1\n\
         BEGIN\n\
           BLOCK \"StringFileInfo\"\n\
           BEGIN\n\
             BLOCK \"040904B0\"\n\
             BEGIN\n\
               VALUE \"CompanyName\", \"SprayLab\"\n\
               VALUE \"FileDescription\", \"SprayLab Direction\"\n\
               VALUE \"FileVersion\", \"{version}\"\n\
               VALUE \"ProductName\", \"SprayLab Direction\"\n\
               VALUE \"ProductVersion\", \"{version}\"\n\
               VALUE \"LegalCopyright\", \"GPL-3.0\"\n\
             END\n\
           END\n\
           BLOCK \"VarFileInfo\"\n\
           BEGIN\n\
             VALUE \"Translation\", 0x409, 1200\n\
           END\n\
         END\n"
    );
    write("app.rc", rc.as_bytes())?;
    let zig = std::env::var("ZIG").unwrap_or_else(|_| "zig".into());
    let status = Command::new(&zig)
        .args(["rc", "/fo", "app.res", "app.rc"])
        .current_dir(out)
        .status()
        .map_err(|error| format!("cannot run {zig} rc ({error})"))?;
    if !status.success() {
        return Err(format!("{zig} rc failed ({status})"));
    }
    Ok(out.join("app.res"))
}
