// Algerian school system: preschool (1 year) -> primary (5 years) -> middle
// (4 years) -> high school (3 years). High school year 1 (1AS) is a shared
// common-core track; years 2-3 (2AS/3AS) branch into specialty streams.
// i18n labels live under the `school_level.*` / `specialty.*` keys in
// lib/i18n.jsx.

export const SCHOOL_LEVELS = ["preschool", "primary", "middle", "high"];

export const SCHOOL_LEVEL_YEAR_COUNT = { preschool: 1, primary: 5, middle: 4, high: 3 };

// High school year 1 (1AS): the two common-core tracks.
export const HIGH_YEAR1_SPECIALTIES = ["common_science", "common_arts"];

// High school years 2-3 (2AS/3AS): the specialty branches.
export const HIGH_YEAR23_SPECIALTIES = [
  "science_exp", "math", "tech_math", "management_econ", "arts_philo", "foreign_lang",
];

export function specialtiesFor(level, year) {
  if (level !== "high" || !year) return [];
  return year === 1 ? HIGH_YEAR1_SPECIALTIES : HIGH_YEAR23_SPECIALTIES;
}
