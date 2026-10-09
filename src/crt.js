// Adapted from Timothy Lottes' public-domain CRT shader (2014).
// https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl
// Lottes' Gaussian reconstruction, linear-light scanlines, bloom and RGB mask
// are retained. Playload adds a small inset, rounded glass and edge shading.
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
varying vec2 uv;
const vec2 sourceSize = vec2(160.0, 144.0);

float toLinear(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float toSrgb(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }

vec3 fetch(vec2 p, vec2 offset) {
  vec2 pixel = floor(p * sourceSize + offset);
  if (pixel.x < 0.0 || pixel.y < 0.0 || pixel.x >= sourceSize.x || pixel.y >= sourceSize.y) return vec3(0.0);
  vec3 c = texture2D(image, (pixel + 0.5) / sourceSize).rgb;
  return vec3(toLinear(c.r), toLinear(c.g), toLinear(c.b));
}
vec2 dist(vec2 p) { return 0.5 - fract(p * sourceSize); }
float gauss(float x, float hardness) { return exp2(hardness * x * x); }

vec3 horizontal(vec2 p, float row, float hardness, int radius) {
  float d = dist(p).x;
  vec3 color = vec3(0.0);
  float total = 0.0;
  for (int i = -3; i <= 3; i++) {
    if (i < -radius || i > radius) continue;
    float weight = gauss(d + float(i), hardness);
    color += fetch(p, vec2(float(i), row)) * weight;
    total += weight;
  }
  return color / total;
}
vec3 scanlines(vec2 p) {
  float d = dist(p).y;
  return horizontal(p, -1.0, -4.5, 1) * gauss(d - 1.0, -6.0) +
    horizontal(p, 0.0, -4.5, 2) * gauss(d, -6.0) +
    horizontal(p, 1.0, -4.5, 1) * gauss(d + 1.0, -6.0);
}
vec3 bloom(vec2 p) {
  float d = dist(p).y;
  return horizontal(p, -2.0, -4.5, 2) * gauss(d - 2.0, -2.0) +
    horizontal(p, -1.0, -1.5, 3) * gauss(d - 1.0, -2.0) +
    horizontal(p, 0.0, -1.5, 3) * gauss(d, -2.0) +
    horizontal(p, 1.0, -1.5, 3) * gauss(d + 1.0, -2.0) +
    horizontal(p, 2.0, -4.5, 2) * gauss(d + 2.0, -2.0);
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
  // CRT-Lottes' default curvature; the inset retains the complete game image.
  vec2 warped = position * vec2(1.0 + 0.031 * position.y * position.y, 1.0 + 0.041 * position.x * position.x) / 0.98;
  vec2 p = warped * 0.5 + 0.5;
  // Rounded tube corners, with a narrow antialiased edge in source coordinates.
  vec2 corner = max(abs(warped) - vec2(1.0), 0.0);
  float glass = 1.0 - smoothstep(0.018, 0.024, length(corner));
  if (abs(warped.x) >= 1.024 || abs(warped.y) >= 1.024) glass = 0.0;
  float vignette = 1.0 - 0.13 * dot(position, position) * 0.5;
  vec3 color = (scanlines(p) + 0.13 * bloom(p)) * mask(gl_FragCoord.xy) * vignette * glass;
  gl_FragColor = vec4(toSrgb(color.r), toSrgb(color.g), toSrgb(color.b), 1.0);
}`;

export function createCRT(palette, width = 640, height = 576) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
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
  const data = new Uint8Array(160 * 144 * 4),
    colors = palette.map((hex) =>
      [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)),
    );
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.viewport(0, 0, width, height);
  return {
    canvas,
    render(pixels) {
      if (gl.isContextLost()) return false;
      for (let i = 0; i < pixels.length; i++) {
        const color = colors[pixels[i]],
          offset = i * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = 255;
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 160, 144, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return true;
    },
  };
}
