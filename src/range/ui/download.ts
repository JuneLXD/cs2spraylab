export function download(name: string, value: unknown) {
  downloadText(name, JSON.stringify(value, null, 2), 'application/json');
}
/** Saves `text` as a file named `name` (a page, a report) through a temporary link. */
export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
