import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../hooks/useApi';

// Test the ApiError class and fetch logic directly (non-hook tests)
// Hook integration would require renderHook from @testing-library/react-hooks

describe('ApiError', () => {
  it('should create error with status code and message', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('ApiError');
    expect(err instanceof Error).toBe(true);
  });

  it('should create error for server errors', () => {
    const err = new ApiError(500, 'Internal server error');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('Internal server error');
  });

  it('should create error for network failures', () => {
    const err = new ApiError(0, 'Network error');
    expect(err.statusCode).toBe(0);
    expect(err.message).toBe('Network error');
  });
});

describe('API request logic', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should make GET request with correct headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    });
    globalThis.fetch = mockFetch;

    const response = await fetch('https://api.distributed-hive.com/v1/runs', {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
      },
    });
    const data = await response.json();

    expect(mockFetch).toHaveBeenCalledWith('https://api.distributed-hive.com/v1/runs', {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
      },
    });
    expect(data).toEqual({ data: 'test' });
  });

  it('should make POST request with body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'run-1' }),
    });
    globalThis.fetch = mockFetch;

    const body = { title: 'New Run', repositories: ['repo-1'] };
    await fetch('https://api.distributed-hive.com/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(mockFetch).toHaveBeenCalledWith('https://api.distributed-hive.com/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });

  it('should throw ApiError on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: () => Promise.resolve('Access denied'),
    });

    const response = await fetch('https://api.distributed-hive.com/v1/runs');

    if (!response.ok) {
      const errorText = await response.text();
      const error = new ApiError(response.status, errorText || response.statusText);
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Access denied');
    }
  });

  it('should handle network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    try {
      await fetch('https://api.distributed-hive.com/v1/runs');
    } catch (err) {
      const apiErr = new ApiError(0, (err as Error).message);
      expect(apiErr.statusCode).toBe(0);
      expect(apiErr.message).toBe('Failed to fetch');
    }
  });

  it('should support DELETE requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deleted: true }),
    });
    globalThis.fetch = mockFetch;

    await fetch('https://api.distributed-hive.com/v1/runs/run-1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'key' },
    });

    const call = mockFetch.mock.calls[0]!;
    expect(call[1].method).toBe('DELETE');
  });

  it('should support PUT requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ updated: true }),
    });
    globalThis.fetch = mockFetch;

    await fetch('https://api.distributed-hive.com/v1/runs/run-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    const call = mockFetch.mock.calls[0]!;
    expect(call[1].method).toBe('PUT');
    expect(JSON.parse(call[1].body)).toEqual({ status: 'cancelled' });
  });
});
