// One-shot: convert oklch() values used in globals.css to sRGB hex
function oklchToRgb(L, C, H) {
  const hr = (H * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  let bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const toS = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
  r = Math.min(1, Math.max(0, toS(r)))
  g = Math.min(1, Math.max(0, toS(g)))
  bb = Math.min(1, Math.max(0, toS(bb)))
  return [Math.round(r * 255), Math.round(g * 255), Math.round(bb * 255)]
}

const vals = [
  ['oklch(1 0 0)', 1, 0, 0],
  ['oklch(0.145 0 0)', 0.145, 0, 0],
  ['oklch(0.205 0 0)', 0.205, 0, 0],
  ['oklch(0.985 0 0)', 0.985, 0, 0],
  ['oklch(0.97 0 0)', 0.97, 0, 0],
  ['oklch(0.556 0 0)', 0.556, 0, 0],
  ['oklch(0.922 0 0)', 0.922, 0, 0],
  ['oklch(0.708 0 0)', 0.708, 0, 0],
  ['oklch(0.577 0.245 27.325)', 0.577, 0.245, 27.325],
  ['oklch(0.646 0.222 41.116)', 0.646, 0.222, 41.116],
  ['oklch(0.6 0.118 184.704)', 0.6, 0.118, 184.704],
  ['oklch(0.398 0.07 227.392)', 0.398, 0.07, 227.392],
  ['oklch(0.828 0.189 84.429)', 0.828, 0.189, 84.429],
  ['oklch(0.769 0.188 70.08)', 0.769, 0.188, 70.08],
  ['oklch(0.269 0 0)', 0.269, 0, 0],
  ['oklch(0.704 0.191 22.216)', 0.704, 0.191, 22.216],
  ['oklch(0.488 0.243 264.376)', 0.488, 0.243, 264.376],
  ['oklch(0.696 0.17 162.48)', 0.696, 0.17, 162.48],
  ['oklch(0.627 0.265 303.9)', 0.627, 0.265, 303.9],
  ['oklch(0.645 0.246 16.439)', 0.645, 0.246, 16.439],
]
for (const [k, L, C, H] of vals) {
  const [r, g, b] = oklchToRgb(L, C, H)
  const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
  console.log(`${k} -> ${hex}`)
}
