/**
 * True for JSON and HTML-form bodies, which this endpoint refuses (the file itself must be the
 * body). Matches the media type exactly: a loose "includes('form')" also caught Word files,
 * whose type is application/vnd.openxmlformats-officedocument.wordprocessingml.document.
 */
export function isFormOrJson(header: string | string[] | undefined): boolean {
  const mediaType = String(header ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  return (
    mediaType === 'application/json' ||
    mediaType.endsWith('+json') ||
    mediaType === 'multipart/form-data' ||
    mediaType === 'application/x-www-form-urlencoded'
  );
}
