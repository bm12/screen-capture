import { iceServers as fallbackIceServers } from './constants';

export type IceServer = RTCIceServer;

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_UID = 'web';
const ICE_ENDPOINT = import.meta.env.VITE_ICE_URL || '/ice';
export const DYNAMIC_ICE_ENABLED = import.meta.env.VITE_USE_DYNAMIC_ICE === 'true';

interface CacheEntry {
  timestamp: number;
  servers: RTCIceServer[];
}

const cache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<RTCIceServer[]>>();

const isIceServer = (value: unknown): value is RTCIceServer => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<RTCIceServer>;
  if (typeof candidate.urls === 'string') {
    return true;
  }
  return Array.isArray(candidate.urls);
};

const extractIceServers = (payload: unknown): RTCIceServer[] => {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.filter(isIceServer) as RTCIceServer[];
  }

  if (typeof payload === 'object') {
    const maybeServers = (payload as { iceServers?: unknown }).iceServers;
    if (Array.isArray(maybeServers)) {
      return maybeServers.filter(isIceServer) as RTCIceServer[];
    }
  }

  return [];
};

const normalizeUid = (uid?: string): string => {
  if (!uid) {
    return DEFAULT_UID;
  }
  const trimmed = uid.trim();
  if (!trimmed) {
    return DEFAULT_UID;
  }
  return trimmed.slice(0, 64);
};

const buildRequestUrl = (uid: string): string => {
  if (!uid || uid === DEFAULT_UID) {
    return ICE_ENDPOINT;
  }
  const separator = ICE_ENDPOINT.includes('?') ? '&' : '?';
  return `${ICE_ENDPOINT}${separator}uid=${encodeURIComponent(uid)}`;
};

const requestIceServers = async (uid: string): Promise<RTCIceServer[]> => {
  if (typeof fetch !== 'function') {
    console.warn('[ice] fetch API is not available in the current environment.');
    return [];
  }
  const response = await fetch(buildRequestUrl(uid), { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`ICE fetch failed with status ${response.status}`);
  }
  const payload = await response.json();
  return extractIceServers(payload);
};

export const FALLBACK_ICE_SERVERS = fallbackIceServers;

export const getFallbackIceServers = (): RTCIceServer[] => [...fallbackIceServers];

export const getDynamicIceServers = async (uid?: string): Promise<RTCIceServer[]> => {
  if (!DYNAMIC_ICE_ENABLED) {
    return [];
  }

  const normalizedUid = normalizeUid(uid);
  const cached = cache.get(normalizedUid);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.servers;
  }

  const pending = pendingRequests.get(normalizedUid);
  if (pending) {
    try {
      return await pending;
    } catch {
      return [];
    }
  }

  const requestPromise = (async () => {
    try {
      const servers = await requestIceServers(normalizedUid);
      cache.set(normalizedUid, { timestamp: Date.now(), servers });
      return servers;
    } catch (error) {
      console.error(`[ice] Failed to fetch ICE servers for uid "${normalizedUid}"`, error);
      throw error;
    } finally {
      pendingRequests.delete(normalizedUid);
    }
  })();

  pendingRequests.set(normalizedUid, requestPromise);

  try {
    return await requestPromise;
  } catch {
    return [];
  }
};

export const getEffectiveIceServers = async (uid?: string): Promise<RTCIceServer[]> => {
  const dynamicServers = await getDynamicIceServers(uid);
  return [...fallbackIceServers, ...dynamicServers];
};

export const prefetchIceServers = (uid?: string) => {
  if (!DYNAMIC_ICE_ENABLED) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  getDynamicIceServers(uid);
};

export const clearIceCache = () => {
  cache.clear();
  pendingRequests.clear();
};
