/** The address without its query string ("/api/v1/search?q=fees" becomes "/api/v1/search"). */
export function pathOnly(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return url;
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}
