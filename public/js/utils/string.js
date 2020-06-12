/**
 * Gets a string like 'Now: {{time}}'
 * and replace with values from the object
 * @param {string} string
 * @param {object} values
 */
export const templateParser = (string, values) => {
  if (!string) return '';
  if (!values) return string;
  return string.replace(/{{(\w+)}}/ig, (full, match) => values[match]);
}
