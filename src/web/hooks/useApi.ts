import { useCallback, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.distributed-hive.com';
const API_KEY = import.meta.env.VITE_API_KEY || '';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface UseApiOptions {
  baseUrl?: string;
  apiKey?: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function useApi(options: UseApiOptions = {}) {
  const baseUrl = options.baseUrl || API_BASE;
  const apiKey = options.apiKey || API_KEY;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const request = useCallback(
    async <T>(path: string, opts: RequestOptions = {}): Promise<T> => {
      // Cancel any in-flight request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...opts.headers,
      };

      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: opts.method || 'GET',
          headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: opts.signal || controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new ApiError(response.status, errorText || response.statusText);
        }

        const data = (await response.json()) as T;
        setLoading(false);
        return data;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Request was cancelled - don't update state
          throw err;
        }
        const apiErr =
          err instanceof ApiError
            ? err
            : new ApiError(0, (err as Error).message || 'Network error');
        setError(apiErr);
        setLoading(false);
        throw apiErr;
      }
    },
    [baseUrl, apiKey]
  );

  const get = useCallback(<T>(path: string) => request<T>(path), [request]);

  const post = useCallback(
    <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body }),
    [request]
  );

  const put = useCallback(
    <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
    [request]
  );

  const del = useCallback(<T>(path: string) => request<T>(path, { method: 'DELETE' }), [request]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return { request, get, post, put, del, cancel, loading, error };
}
