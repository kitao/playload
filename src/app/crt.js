import { rgb } from '../engine/engine.js';

// Adapted from Timothy Lottes' public-domain CRT shader (2014).
// https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl
// Lottes' Gaussian reconstruction, linear-light scanlines, bloom and RGB mask
// are retained. The picture fills the same maximum width and height as flat
// mode; the glass mask is framed separately to retain edge pixels and glow.
const vertexSource = `
attribute vec2 position;
varying vec2 uv;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
}`;

const fragmentSource = `
precision highp float;
uniform sampler2D image;
uniform vec3 background;
uniform vec3 colors[8];
varying vec2 uv;
const vec2 sourceSize = vec2(160.0, 144.0);

float toSrgb(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }

vec3 fetch(vec2 pixel) {
  // A three-column/two-row black guard band covers the entire filter kernel.
  // CLAMP_TO_EDGE extends that black beyond the texture, avoiding per-tap
  // coordinate bounds checks without smearing the edge texels.
  float index = texture2D(image, (pixel + vec2(3.5, 2.5)) / vec2(166.0, 148.0)).r * 255.0;
  // Constant uniform indices also work on GLSL ES 1.00 implementations that
  // cannot index fragment uniform arrays dynamically. The palette is already
  // in linear light, so each tap avoids three sRGB power functions.
  if (index < 3.5) {
    if (index < 1.5) return index < 0.5 ? colors[0] : colors[1];
    return index < 2.5 ? colors[2] : colors[3];
  }
  if (index < 5.5) return index < 4.5 ? colors[4] : colors[5];
  return index < 6.5 ? colors[6] : index < 7.5 ? colors[7] : vec3(0.0);
}
float gauss(float x, float hardness) { return exp2(hardness * x * x); }

vec3 reconstruct(vec2 p) {
  vec2 pixel = floor(p * sourceSize);
  vec2 d = 0.5 - fract(p * sourceSize);
  // Horizontal weights depend only on the subpixel phase, not the row.
  // Share them across all five rows, and share each source tap between the
  // sharp scanlines and the wider bloom kernel (31 reads instead of 42).
  float sharp[5];
  float wide[7];
  // Factor exp2(h * (d + x)^2) into exp2(h*d*d), exp2(2*h*d)^x
  // and exp2(h*x*x). The first factor cancels during normalization, and
  // the last is constant. The sharp kernel is the cube of the wide one.
  // This retains the same Gaussians with one horizontal exponent instead of 12.
  float stepX = exp2(-3.0 * d.x);
  float inverseX = 1.0 / stepX;
  wide[0] = 0.00008631674575031098 * inverseX * inverseX * inverseX;
  wide[1] = 0.015625 * inverseX * inverseX;
  wide[2] = 0.3535533905932738 * inverseX;
  wide[3] = 1.0;
  wide[4] = 0.3535533905932738 * stepX;
  wide[5] = 0.015625 * stepX * stepX;
  wide[6] = 0.00008631674575031098 * stepX * stepX * stepX;
  float sharpTotal = 0.0;
  float wideTotal = 0.0;
  for (int x = 0; x < 5; x++) {
    float weight = wide[x + 1];
    sharp[x] = weight * weight * weight;
    sharpTotal += sharp[x];
  }
  for (int x = 0; x < 7; x++) wideTotal += wide[x];
  float narrowTotal = sharp[1] + sharp[2] + sharp[3];
  float narrow[3];
  for (int x = 0; x < 3; x++) narrow[x] = sharp[x + 1] / narrowTotal;
  for (int x = 0; x < 5; x++) sharp[x] /= sharpTotal;
  for (int x = 0; x < 7; x++) wide[x] /= wideTotal;
  float vertical[5];
  float center = gauss(d.y, -2.0);
  float stepY = exp2(-4.0 * d.y);
  float inverseY = 1.0 / stepY;
  vertical[0] = center * 0.00390625 * inverseY * inverseY;
  vertical[1] = center * 0.25 * inverseY;
  vertical[2] = center;
  vertical[3] = center * 0.25 * stepY;
  vertical[4] = center * 0.00390625 * stepY * stepY;
  vec3 color = vec3(0.0);
  for (int row = -2; row <= 2; row++) {
    float weightY = vertical[row + 2];
    float glow = 0.13 * weightY;
    float scan = weightY * weightY * weightY;
    if (row == -2 || row == 2) {
      for (int x = 0; x < 5; x++)
        color += fetch(pixel + vec2(float(x - 2), float(row))) * sharp[x] * glow;
    } else {
      for (int x = 0; x < 7; x++) {
        float weight = wide[x] * glow;
        if (row == 0) {
          if (x >= 1 && x <= 5) weight += sharp[x - 1] * scan;
        } else {
          if (x >= 2 && x <= 4) weight += narrow[x - 2] * scan;
        }
        color += fetch(pixel + vec2(float(x - 3), float(row))) * weight;
      }
    }
  }
  return color;
}
vec3 mask(vec2 p) {
  // A gentle aperture grille remains readable at four-times rendering scale.
  float stripe = mod(floor(p.x), 3.0);
  if (stripe < 1.0) return vec3(1.16, 0.92, 0.92);
  if (stripe < 2.0) return vec3(0.92, 1.16, 0.92);
  return vec3(0.92, 0.92, 1.16);
}
void main() {
  vec2 position = uv * 2.0 - 1.0;
  // Retain CRT-Lottes' default curvature without shrinking the picture.
  vec2 warped = position * vec2(1.0 + 0.031 * position.y * position.y, 1.0 + 0.041 * position.x * position.x);
  vec2 p = warped * 0.5 + 0.5;
  // Frame the glass independently; this factor only affects its opacity mask.
  vec2 corner = max(abs(warped * 0.98) - vec2(0.97), 0.0);
  float glass = 1.0 - smoothstep(0.028, 0.032, length(corner));
  float vignette = 1.0 - 0.13 * dot(position, position) * 0.5;
  vec3 color = reconstruct(p) * mask(gl_FragCoord.xy) * vignette;
  vec3 srgb = vec3(toSrgb(color.r), toSrgb(color.g), toSrgb(color.b));
  // Outside the image, retain the surrounding color and the phosphor glow.
  vec2 edge = (abs(warped) - 1.0) * sourceSize * 0.5;
  vec3 surround = background * clamp(max(edge.x, edge.y) + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(background, srgb + surround, glass), 1.0);
}`;

export function createCRT(palette, width = 640, height = 576, background = '#000000') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    // The caller copies the result to the display/capture canvas immediately.
    // Keeping another copy of the WebGL back buffer is unnecessary, especially
    // on mobile GPUs that render in tiles.
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('CRT shader compilation failed');
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource),
    fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('CRT shader link failed');
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
  gl.uniform3fv(
    gl.getUniformLocation(program, 'background'),
    rgb(background).map((value) => value / 255),
  );
  gl.uniform3fv(
    gl.getUniformLocation(program, 'colors[0]'),
    palette.flatMap((hex) =>
      rgb(hex).map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }),
    ),
  );
  // Index 255 is black independently of the palette. Populate only the game
  // area each frame; the guard band stays black and the upload remains one
  // byte per pixel, with no RGBA expansion or per-frame allocation.
  const data = new Uint8Array(166 * 148).fill(255);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 166, 148, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
  gl.viewport(0, 0, width, height);
  return {
    canvas,
    render(pixels) {
      if (gl.isContextLost()) return false;
      for (let y = 0; y < 144; y++)
        for (let x = 0; x < 160; x++) data[(y + 2) * 166 + x + 3] = pixels[y * 160 + x];
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 166, 148, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return true;
    },
  };
}
