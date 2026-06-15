const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!BASE) {
  console.warn('EXPO_PUBLIC_BACKEND_URL not set');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const txt = await res.text();
    // Prefix the HTTP status so callers can branch on it (e.g. 404 → "not found"
    // copy instead of leaking the raw JSON body to the user).
    const err = new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export interface ScanResult {
  name: string;
  set_name?: string | null;
  number?: string | null;
  confidence?: string;
  cropped_image?: string | null;
  crop_detected?: boolean;
}

export interface PriceData {
  card_id?: string;
  name: string;
  set_name?: string | null;
  number?: string | null;
  image_url?: string | null;
  tcgplayer_market?: number | null;
  tcgplayer_holofoil_market?: number | null;
  tcgplayer_normal_market?: number | null;
  tcgplayer_variant?: string | null;
  cardmarket_average?: number | null;
  cardmarket_trend?: number | null;
  recommended_eur?: number | null;
  price_source?: string | null;
  usd_to_eur_rate?: number;
  currency: string;
}

export interface Condition {
  centering: string;
  corners: string;
  edges: string;
  surface: string;
  whitening: boolean;
  scratches: boolean;
}

export interface CardRecord {
  id: string;
  user_id: string;
  name: string;
  set_name?: string | null;
  number?: string | null;
  image_url?: string | null;
  market_price: number;
  estimated_value: number;
  condition: Condition;
  condition_grade: string;
  condition_multiplier: number;
  created_at: string;
  tcgplayer_market?: number | null;
  cardmarket_average?: number | null;
  cardmarket_trend?: number | null;
  price_source?: string | null;
  price_at_creation?: number | null;
  card_id?: string | null;
}

export interface ScanCount {
  user_id: string;
  count: number;
  free_limit: number;
  is_pro: boolean;
}

export interface SetSummary {
  id: string;
  name: string;
  series?: string | null;
  release_date?: string | null;
  total?: number | null;
  printed_total?: number | null;
  symbol_url?: string | null;
  logo_url?: string | null;
}

export const api = {
  analyzeImage: (image_base64: string, user_id?: string) =>
    request<ScanResult>('/scan/analyze', {
      method: 'POST',
      body: JSON.stringify({ image_base64, user_id }),
    }),
  getPrice: (params: { name: string; set_name?: string; number?: string }) => {
    const q = new URLSearchParams();
    q.set('name', params.name);
    if (params.set_name) q.set('set_name', params.set_name);
    if (params.number) q.set('number', params.number);
    return request<PriceData>(`/price?${q.toString()}`);
  },
  listSets: () => request<SetSummary[]>('/sets'),
  findCard: (params: { set_id: string; number: string }) => {
    const q = new URLSearchParams();
    q.set('set_id', params.set_id);
    q.set('number', params.number);
    return request<PriceData>(`/cards/find?${q.toString()}`);
  },
  searchCards: (params: { set_id: string; name: string }) => {
    const q = new URLSearchParams();
    q.set('set_id', params.set_id);
    q.set('name', params.name);
    return request<PriceData[]>(`/cards/search?${q.toString()}`);
  },
  saveCard: (payload: Omit<CardRecord, 'id' | 'created_at'>) =>
    request<CardRecord>('/portfolio/save', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPortfolio: (user_id: string) => request<CardRecord[]>(`/portfolio/${user_id}`),
  deleteCard: (card_id: string) =>
    request<{ deleted: number }>(`/portfolio/${card_id}`, { method: 'DELETE' }),
  getScanCount: (user_id: string) => request<ScanCount>(`/scan/count/${user_id}`),
  incrementScan: (user_id: string) =>
    request<ScanCount>(`/scan/count/${user_id}`, { method: 'POST' }),
  upgrade: (user_id: string) =>
    request<ScanCount>(`/scan/upgrade/${user_id}`, { method: 'POST' }),
};
