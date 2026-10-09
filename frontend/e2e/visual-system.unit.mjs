import test from "node:test";
import assert from "node:assert/strict";
import { hospitalPalette, brandVariables, contrastRatio, validateWalkIn } from "../src/utils/visualSystem.js";
test("brand colors accept normalized hex and refuse arbitrary CSS", () => {
  assert.equal(hospitalPalette("#FDE68A").accent, "#fde68a");
  assert.equal(hospitalPalette("#fff").accent, "#ffffff");
  for (const value of [undefined, "red", "url(example)", "#abcd", "rgb(1,2,3)"]) assert.equal(hospitalPalette(value).accent, "#115e59");
});
test("brand actions and text maintain accessible contrast on light and dark surfaces", () => {
  for (const color of ["#ffffff", "#000000", "#fde68a", "#ef4444", "#777777", "#1d4ed8", "#22c55e", "#115e59", "#fff", "#808000"]) {
    const palette = hospitalPalette(color);
    assert.ok(contrastRatio(palette.accent, palette.onAccent) >= 4.5, color);
    assert.ok(contrastRatio(palette.ink, "#faf9f6") >= 4.5, color);
    assert.ok(contrastRatio(palette.ink, palette.soft) >= 4.5, color);
    assert.ok(contrastRatio(palette.inkDark, "#172c34") >= 4.5, color);
    assert.ok(contrastRatio(palette.inkDark, palette.softDark) >= 4.5, color);
  }
});
test("brand overrides only emit normalized color tokens", () => {
  const variables = brandVariables("#abc"); assert.equal(variables["--mp-accent"], "#aabbcc");
  assert.ok(Object.values(variables).every(value => /^#[a-f0-9]{6}$/.test(value)));
});
test("walk-in validation has field errors and requires an identified patient", () => {
  assert.equal(validateWalkIn({ name: " ", phone: "abc", age: "-1" }).name, "Enter the patient's name.");
  assert.ok(validateWalkIn({ name: "Fixture", phone: "letters", age: "131" }).phone);
  assert.ok(validateWalkIn({ name: "Fixture", age: "NaN" }).age);
  assert.ok(validateWalkIn({ name: "Fixture", phone: "-------", age: "" }).phone);
});
test("optional contact and age fields do not invent patient information", () => {
  assert.deepEqual(validateWalkIn({ name: "Fixture", phone: "", age: "" }), {});
  assert.deepEqual(validateWalkIn({ name: "Fixture" }), {});
  assert.deepEqual(validateWalkIn({ name: "Fixture", phone: "+91 90000 00000", age: "0" }), {});
});
