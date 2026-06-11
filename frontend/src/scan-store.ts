/**
 * In-memory store for images captured during a scan flow.
 * We avoid putting heavy base64 blobs in expo-router params (URL size limits).
 * Entries are short-lived: written in scan.tsx, read once in card-detail.tsx,
 * then cleared.
 */
const captured = new Map<string, string>();

let counter = 0;
const newScanId = () => {
  counter += 1;
  return `scan_${Date.now()}_${counter}`;
};

export const scanStore = {
  putCapturedImage(dataUri: string): string {
    const id = newScanId();
    captured.set(id, dataUri);
    return id;
  },
  getCapturedImage(id?: string | null): string | null {
    if (!id) return null;
    return captured.get(id) ?? null;
  },
  clear(id?: string | null) {
    if (id) captured.delete(id);
  },
};
