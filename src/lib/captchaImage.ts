import { PNG } from "pngjs";

// ─── 5x7 bitmap digits (MSB = leftmost column) ────────────────────────────

const DIGIT_BITMAPS: Record<string, number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
};

const DIGIT_W = 5;
const DIGIT_H = 7;
const SCALE = 4;
const GAP_PX = 8;
const PAD_PX = 14;
const MAX_ANGLE_DEG = 15;

/**
 * Render a digit as a scaled boolean bitmap (true = ink pixel).
 */
function renderDigitBitmap(digit: string, scale: number): boolean[][] {
  const bitmap = DIGIT_BITMAPS[digit] ?? DIGIT_BITMAPS["0"];
  const w = DIGIT_W * scale;
  const h = DIGIT_H * scale;
  const pixels: boolean[][] = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));

  for (let row = 0; row < DIGIT_H; row++) {
    for (let col = 0; col < DIGIT_W; col++) {
      if (!(bitmap[row] & (1 << (DIGIT_W - 1 - col)))) continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          pixels[row * scale + sy][col * scale + sx] = true;
        }
      }
    }
  }
  return pixels;
}

/**
 * Rotate a boolean bitmap around its center by `angleDeg` (nearest-neighbor
 * sampling). Returns the new bitmap plus its dimensions.
 */
function rotatePixels(
  src: boolean[][],
  angleDeg: number,
): { pixels: boolean[][]; w: number; h: number } {
  const h = src.length;
  const w = src[0].length;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const newW = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
  const newH = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
  const out: boolean[][] = Array.from({ length: newH }, () => new Array<boolean>(newW).fill(false));

  const cx = w / 2;
  const cy = h / 2;
  const ncx = newW / 2;
  const ncy = newH / 2;

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const dx = x - ncx;
      const dy = y - ncy;
      // Inverse rotation to find the source pixel
      const sx = Math.round(dx * cos + dy * sin + cx);
      const sy = Math.round(-dx * sin + dy * cos + cy);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h && src[sy][sx]) {
        out[y][x] = true;
      }
    }
  }
  return { pixels: out, w: newW, h: newH };
}

/**
 * Draw a line between two points (Bresenham) with the given thickness.
 */
function drawLine(
  setPixel: (x: number, y: number, color: number[]) => void,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number[],
  thickness: number,
) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  const half = Math.floor(thickness / 2);
  for (;;) {
    for (let ty = 0; ty < thickness; ty++) {
      for (let tx = 0; tx < thickness; tx++) {
        setPixel(x + tx - half, y + ty - half, color);
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Pick a random point on one of the four canvas edges.
 */
function randomEdgePoint(width: number, height: number): [number, number] {
  const edge = Math.floor(Math.random() * 4);
  switch (edge) {
    case 0:
      return [Math.floor(Math.random() * width), 0];
    case 1:
      return [Math.floor(Math.random() * width), height - 1];
    case 2:
      return [0, Math.floor(Math.random() * height)];
    default:
      return [width - 1, Math.floor(Math.random() * height)];
  }
}

/**
 * Render a captcha code (e.g. "4821") as a PNG buffer. Each digit is drawn
 * from a 5x7 bitmap font, scaled up, then rotated by a random angle (each
 * digit independently, ±15°) and shifted vertically at random. Random
 * interference lines cross the image and scattered noise pixels are added,
 * all on a light background with dark digits. Cosmetic randomness uses
 * Math.random; the code itself is generated with a CSPRNG (verifyManager).
 */
export function renderCaptchaImage(code: string): Buffer {
  const clean = code.replace(/[^0-9]/g, "").slice(0, 4) || "0000";

  // Pre-compute each digit's rotated bitmap so the canvas fits exactly
  const transforms = clean.split("").map((d) => {
    const angle = (Math.random() * 2 - 1) * MAX_ANGLE_DEG;
    const rotated = rotatePixels(renderDigitBitmap(d, SCALE), angle);
    const dy = Math.floor(Math.random() * 5) - 2; // -2..2 px vertical shift
    return { pixels: rotated.pixels, w: rotated.w, h: rotated.h, dy };
  });

  const totalW =
    PAD_PX * 2 + transforms.reduce((acc, t) => acc + t.w, 0) + GAP_PX * (clean.length - 1);
  const maxH = Math.max(...transforms.map((t) => t.h));
  const width = totalW;
  const height = PAD_PX * 2 + maxH;

  // Light background + dark digits, both with a random tint each render.
  const bg = [190 + Math.floor(Math.random() * 40), 190 + Math.floor(Math.random() * 40), 195 + Math.floor(Math.random() * 40)];
  const fg = [20 + Math.floor(Math.random() * 50), 25 + Math.floor(Math.random() * 50), 30 + Math.floor(Math.random() * 50)];

  const png = new PNG({ width, height });

  const setPixel = (x: number, y: number, [r, g, b]: number[]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = (width * y + x) << 2;
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = 255;
  };

  // Background fill
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(x, y, bg);
    }
  }

  // Composite the rotated digits
  let x = PAD_PX;
  for (const t of transforms) {
    const y = PAD_PX + Math.floor((maxH - t.h) / 2) + t.dy;
    for (let py = 0; py < t.h; py++) {
      for (let px = 0; px < t.w; px++) {
        if (t.pixels[py][px]) setPixel(x + px, y + py, fg);
      }
    }
    x += t.w + GAP_PX;
  }

  // Random interference lines crossing the image (2–4 lines, gray shades)
  const lineCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < lineCount; i++) {
    const [x0, y0] = randomEdgePoint(width, height);
    const [x1, y1] = randomEdgePoint(width, height);
    const g = 80 + Math.floor(Math.random() * 120);
    drawLine(setPixel, x0, y0, x1, y1, [g, g, g], 1 + Math.floor(Math.random() * 2));
  }

  // Scattered noise pixels in random colors
  const noiseCount = Math.floor((width * height) / 40);
  for (let i = 0; i < noiseCount; i++) {
    const nx = Math.floor(Math.random() * width);
    const ny = Math.floor(Math.random() * height);
    const color = [
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256),
    ];
    setPixel(nx, ny, color);
  }

  return PNG.sync.write(png);
}
