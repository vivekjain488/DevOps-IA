// Aceternity UI — Canvas Reveal Effect (https://ui.aceternity.com/components/canvas-reveal-effect)
// The original renders through three.js / @react-three/fiber. This port keeps the same props and the
// same GLSL dot-matrix shader but drives it with a bare WebGL2 context, so it adds no dependencies.
import React, { useEffect, useMemo, useRef } from 'react';
import { cn } from '../../lib/utils';

export const CanvasRevealEffect = ({
  animationSpeed = 0.4,
  opacities = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1],
  colors = [[0, 255, 255]],
  containerClassName,
  dotSize,
  totalSize = 4, // added in this port: dot spacing, in the shader's 2x units
  showGradient = true
}) => (
  <div className={cn('h-full relative bg-white w-full', containerClassName)}>
    <div className="h-full w-full">
      <DotMatrix
        colors={colors ?? [[0, 255, 255]]}
        dotSize={dotSize ?? 3}
        totalSize={totalSize}
        opacities={opacities ?? [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1]}
        shader={`
          float animation_speed_factor = ${animationSpeed.toFixed(1)};
          float intro_offset = distance(u_resolution / 2.0 / u_total_size, st2) * 0.01 + (random(st2) * 0.15);
          opacity *= step(intro_offset, u_time * animation_speed_factor);
          opacity *= clamp((1.0 - step(intro_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
        `}
        center={['x', 'y']}
      />
    </div>
    {showGradient && <div className="absolute inset-0 bg-gradient-to-t from-gray-950 to-[84%]" />}
  </div>
);

const DotMatrix = ({ colors = [[0, 0, 0]], opacities = [0.04, 0.04, 0.04, 0.04, 0.04, 0.08, 0.08, 0.08, 0.08, 0.14], totalSize = 4, dotSize = 2, shader = '', center = ['x', 'y'] }) => {
  const colorsArray = useMemo(() => {
    if (colors.length === 2) return [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]];
    if (colors.length === 3) return [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]];
    return Array(6).fill(colors[0]);
  }, [colors]);

  const source = `#version 300 es
    precision mediump float;
    in vec2 fragCoord;
    uniform float u_time;
    uniform float u_opacities[10];
    uniform vec3 u_colors[6];
    uniform float u_total_size;
    uniform float u_dot_size;
    uniform vec2 u_resolution;
    out vec4 fragColor;
    float PHI = 1.61803398874989484820459;
    float random(vec2 xy) { return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x); }
    void main() {
      vec2 st = fragCoord.xy;
      ${center.includes('x') ? 'st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));' : ''}
      ${center.includes('y') ? 'st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));' : ''}
      float opacity = step(0.0, st.x);
      opacity *= step(0.0, st.y);
      vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));
      float frequency = 5.0;
      float show_offset = random(st2);
      float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency) + 1.0);
      opacity *= u_opacities[int(rand * 10.0)];
      opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
      opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));
      vec3 color = u_colors[int(show_offset * 6.0)];
      ${shader}
      fragColor = vec4(color, opacity);
      fragColor.rgb *= fragColor.a;
    }`;

  return (
    <Shader source={source} maxFps={60} uniforms={{
      u_colors: colorsArray.flatMap(color => color.map(channel => channel / 255)),
      u_opacities: opacities,
      u_total_size: totalSize,
      u_dot_size: dotSize
    }} />
  );
};

const VERTEX = `#version 300 es
  precision mediump float;
  in vec2 position;
  uniform vec2 u_resolution;
  out vec2 fragCoord;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
    fragCoord = (position + vec2(1.0)) * 0.5 * u_resolution;
    fragCoord.y = u_resolution.y - fragCoord.y;
  }`;

function compile(gl, type, text) {
  const shader = gl.createShader(type); gl.shaderSource(shader, text); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(shader)); gl.deleteShader(shader); return null; }
  return shader;
}

const Shader = ({ source, uniforms, maxFps = 60 }) => {
  const canvasRef = useRef(null), uniformsRef = useRef(uniforms);
  uniformsRef.current = uniforms;

  useEffect(() => {
    const canvas = canvasRef.current, gl = canvas?.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    if (!gl) return undefined; // WebGL unavailable: the card simply renders without dots.
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX), fragment = compile(gl, gl.FRAGMENT_SHADER, source);
    if (!vertex || !fragment) return undefined;
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const at = name => gl.getUniformLocation(program, name);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let size = { width: 1, height: 1 }, draw = () => {};
    const resize = () => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (reduced) draw(performance.now());
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(canvas);

    let frame = 0, visible = true, last = 0; const start = performance.now();
    draw = now => {
      const u = uniformsRef.current;
      gl.uniform1f(at('u_time'), reduced ? 60 : (now - start) / 1000);
      gl.uniform2f(at('u_resolution'), size.width * 2, size.height * 2); // matches the original's 2x resolution
      gl.uniform1fv(at('u_opacities'), u.u_opacities); gl.uniform3fv(at('u_colors'), u.u_colors);
      gl.uniform1f(at('u_total_size'), u.u_total_size); gl.uniform1f(at('u_dot_size'), u.u_dot_size);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    const loop = now => {
      frame = requestAnimationFrame(loop);
      if (!visible || now - last < 1000 / maxFps) return;
      last = now; draw(now);
    };
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    io.observe(canvas);
    if (reduced) draw(performance.now()); else frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); io.disconnect();
      gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    };
  }, [source, maxFps]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
};
