/**
 * Normalise ITA_MATRIX_SECRET_PATH, so "/abc/" and "abc" mount the same route.
 *
 * Walks the string rather than using a regex, whose backtracking is quadratic
 * on long runs of "/".
 */
export function trimSlashes(value) {
  const s = String(value ?? "");
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === "/") start++;
  while (end > start && s[end - 1] === "/") end--;
  return s.slice(start, end);
}
