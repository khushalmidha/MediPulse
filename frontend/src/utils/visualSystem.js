const rgb = hex => {
  const value = /^#[0-9a-f]{3}$/i.test(hex || "") ? "#" + hex.slice(1).split("").map(x => x + x).join("") : hex;
  return /^#[0-9a-f]{6}$/i.test(value || "") ? [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) : null;
};
const hex = channels => "#" + channels.map(x => Math.round(x).toString(16).padStart(2, "0")).join("");
const luminance = color => rgb(color).map(x => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((total, x, i) => total + x * [0.2126, 0.7152, 0.0722][i], 0);
export const contrastRatio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const hospitalPalette = value => {
  const accent = rgb(value) ? hex(rgb(value)) : "#115e59";
  const channels = rgb(accent);
  const onAccent = contrastRatio(accent, "#ffffff") >= contrastRatio(accent, "#000000") ? "#ffffff" : "#000000";
  const soft = hex(channels.map(x => x * 0.08 + 255 * 0.92));
  const softDark = hex(channels.map((x, i) => x * 0.12 + [23,44,52][i] * 0.88));
  let ink = accent;
  for (let step = 0; Math.min(...["#faf9f6", "#ffffff", soft].map(bg => contrastRatio(ink, bg))) < 4.5 && step < 20; step++) ink = hex(rgb(ink).map(x => x * 0.85));
  let inkDark = accent;
  for (let step = 0; Math.min(...["#172c34", "#102027", softDark].map(bg => contrastRatio(inkDark, bg))) < 4.5 && step < 20; step++) inkDark = hex(rgb(inkDark).map(x => x * 0.8 + 255 * 0.2));
  return { accent, onAccent, ink, inkDark, softDark, soft };
};
export const brandVariables = value => {
  const palette = hospitalPalette(value);
  return { "--mp-accent": palette.accent, "--mp-on-accent": palette.onAccent, "--mp-brand-ink": palette.ink, "--mp-brand-ink-dark": palette.inkDark, "--mp-brand-soft": palette.soft, "--mp-brand-soft-dark": palette.softDark };
};
export const validateWalkIn = values => {
  const errors = {};
  if (!values.name?.trim()) errors.name = "Enter the patient's name.";
  if (values.phone && (!/^\+?[\d\s()-]{7,20}$/.test(values.phone) || values.phone.replace(/\D/g, "").length < 7 || values.phone.replace(/\D/g, "").length > 15)) errors.phone = "Enter a valid phone number.";
  if (values.age != null && values.age !== "" && (!Number.isFinite(Number(values.age)) || Number(values.age) < 0 || Number(values.age) > 130)) errors.age = "Enter an age between 0 and 130.";
  return errors;
};
