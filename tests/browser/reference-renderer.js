// Runs the frozen CRT-Lottes shader, with parameter values matched to Playload.
// Only presentation additions (inset, glass and vignette) are added below;
// the upstream reconstruction, scanline and bloom functions stay unchanged.
export function renderReference(source, pixels, palette) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 576;
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('Reference renderer needs WebGL');
  const vertex =
    'attribute vec2 position; varying vec4 TEX0; void main(){gl_Position=vec4(position,0.0,1.0);TEX0=vec4(position.x*.5+.5,.5-position.y*.5,0.0,1.0);}';
  const marker = 'pos *= vec2(1.0 + (pos.y*pos.y)*warpX, 1.0 + (pos.x*pos.x)*warpY);';
  if (!source.includes(marker)) throw new Error('Unexpected upstream warp');
  source = source.replace(marker, marker + '\n    pos /= 0.98;');
  const output = 'FragColor = vec4(ToSrgb(outColor.rgb), 1.0);';
  if (!source.includes(output)) throw new Error('Unexpected upstream output');
  source = source.replace(
    output,
    `
    vec2 position = TEX0.xy * 2.0 - 1.0;
    vec2 warped = pos * 2.0 - 1.0;
    vec2 corner = max(abs(warped) - vec2(1.0), 0.0);
    float glass = 1.0 - smoothstep(0.018, 0.024, length(corner));
    if (abs(warped.x) >= 1.024 || abs(warped.y) >= 1.024) glass = 0.0;
    outColor *= (1.0 - 0.13 * dot(position, position) * 0.5) * glass;
    ${output}`,
  );
  // Match Playload's high-precision constants. The upstream compatibility
  // wrapper otherwise rounds WebGL uniforms to mediump before reconstruction.
  const fragment =
    '#define FRAGMENT\n#define PARAMETER_UNIFORM\n' +
    source
      .replace(/^#pragma parameter.*$/gm, '')
      .replace(/#define COMPAT_PRECISION mediump/g, '#define COMPAT_PRECISION highp');
  const compile = (type, text) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
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
  for (const [name, value] of Object.entries({
    hardScan: -6,
    hardPix: -4.5,
    warpX: 0.031,
    warpY: 0.041,
    maskDark: 0.92,
    maskLight: 1.16,
    scaleInLinearGamma: 1,
    shadowMask: 2,
    brightBoost: 1,
    hardBloomPix: -1.5,
    hardBloomScan: -2,
    bloomAmount: 0.13,
    shape: 2,
  })) {
    gl.uniform1f(gl.getUniformLocation(program, name), value);
  }
  for (const name of ['TextureSize', 'InputSize'])
    gl.uniform2f(gl.getUniformLocation(program, name), 160, 144);
  gl.uniform2f(gl.getUniformLocation(program, 'OutputSize'), 640, 576);
  const data = new Uint8Array(160 * 144 * 4),
    colors = palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  for (let i = 0; i < pixels.length; i++) {
    data.set(colors[pixels[i]], i * 4);
    data[i * 4 + 3] = 255;
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.uniform1i(gl.getUniformLocation(program, 'Texture'), 0);
  gl.viewport(0, 0, 640, 576);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  return canvas;
}
