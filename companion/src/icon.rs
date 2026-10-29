//! The program's icon, drawn in code so the tray, the window and the .exe file share one design at every size: four
//! arrowheads around a dot, for the four directions a profile corrects, on a dark rounded square. The arrowheads' colour
//! shows the state. build.rs includes this file too, for the .exe's icon.

/// SprayLab's success green (`--sl-go-text`): the profile is on.
pub const ON: [u8; 3] = [0x6f, 0xcf, 0x73];
/// Its caption grey (`--sl-text-3`): off.
pub const OFF: [u8; 3] = [0x8b, 0x96, 0xa1];
/// Its highlight amber (`--sl-t`): switching, or Raw Accel needs a look.
pub const ATTENTION: [u8; 3] = [0xe2, 0xb3, 0x5b];

const BADGE: [u8; 3] = [0x11, 0x16, 0x1b];
const RIM: [u8; 3] = [0x3a, 0x45, 0x50];

/// `size` x `size` pixels of straight (not premultiplied) RGBA, top row first, with `glyph` as the arrowheads' colour.
pub fn rgba(size: u32, glyph: [u8; 3]) -> Vec<u8> {
    // 4 x 4 samples per pixel smooth the edges.
    const N: u32 = 4;
    let s = size as f64;
    // The rim stays at least a pixel wide, so the square stands out on a dark taskbar.
    let rim = (1.0 / s).max(0.045);
    let mut pixels = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            let (mut sum, mut covered) = ([0.0f64; 3], 0.0);
            for sy in 0..N {
                for sx in 0..N {
                    let px = (x as f64 + (sx as f64 + 0.5) / N as f64) / s;
                    let py = (y as f64 + (sy as f64 + 0.5) / N as f64) / s;
                    if let Some(colour) = sample(px, py, rim, glyph) {
                        for (total, channel) in sum.iter_mut().zip(colour) {
                            *total += channel as f64;
                        }
                        covered += 1.0;
                    }
                }
            }
            if covered == 0.0 {
                pixels.extend([0, 0, 0, 0]);
            } else {
                let alpha = (covered / (N * N) as f64 * 255.0).round() as u8;
                pixels.extend([(sum[0] / covered).round() as u8, (sum[1] / covered).round() as u8, (sum[2] / covered).round() as u8, alpha]);
            }
        }
    }
    pixels
}

/// The colour at (x, y) in the unit square, or none outside the rounded square.
fn sample(x: f64, y: f64, rim: f64, glyph: [u8; 3]) -> Option<[u8; 3]> {
    let edge = rounded_square(x, y, 0.035, 0.24);
    if edge > 0.0 {
        return None;
    }
    if in_glyph(x - 0.5, y - 0.5) {
        return Some(glyph);
    }
    Some(if edge > -rim { RIM } else { BADGE })
}

/// Signed distance from (x, y) to a square inset `inset` from the unit square's sides with corners of `radius`: negative
/// inside.
fn rounded_square(x: f64, y: f64, inset: f64, radius: f64) -> f64 {
    let half = 0.5 - inset - radius;
    let (qx, qy) = ((x - 0.5).abs() - half, (y - 0.5).abs() - half);
    qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - radius
}

/// The dot and the four arrowheads, around the centre (0, 0).
fn in_glyph(x: f64, y: f64) -> bool {
    const DOT: f64 = 0.085;
    const BASE: f64 = 0.17;
    const TIP: f64 = 0.37;
    const HALF_WIDTH: f64 = 0.125;
    if x.hypot(y) <= DOT {
        return true;
    }
    [(x, y), (-x, y), (y, x), (-y, x)].iter().any(|&(along, across)| {
        (BASE..=TIP).contains(&along) && across.abs() <= HALF_WIDTH * (TIP - along) / (TIP - BASE)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(image: &[u8], size: u32, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * size + x) * 4) as usize;
        [image[i], image[i + 1], image[i + 2], image[i + 3]]
    }

    #[test]
    fn draws_a_badge_with_coloured_arrowheads_at_any_size() {
        for size in [16, 20, 24, 32, 48, 256] {
            let image = rgba(size, ON);
            assert_eq!(image.len(), (size * size * 4) as usize);
            // Transparent corners, the dot in the glyph colour, badge between the arrowheads.
            assert_eq!(pixel(&image, size, 0, 0)[3], 0, "{size}");
            assert_eq!(pixel(&image, size, size / 2, size / 2), [ON[0], ON[1], ON[2], 255], "{size}");
            let between = pixel(&image, size, size * 3 / 4, size * 3 / 4);
            assert_eq!((between[3], between[0] < 0x40), (255, true), "{size}");
            // The right arrowhead's middle is glyph coloured.
            let arrow = pixel(&image, size, (size as f64 * 0.73) as u32, size / 2);
            assert!(arrow[1] > 0x90, "{size}: {arrow:?}");
        }
        assert_ne!(rgba(32, ON), rgba(32, OFF));
    }
}
