export const titleCase = (text) =>
  text.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
