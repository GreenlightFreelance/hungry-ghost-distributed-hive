import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storage, useAuthStore } from '../stores/authStore';

const mockUser = {
  login: 'testuser',
  avatarUrl: 'https://avatar.url/1',
  name: 'Test User',
};

describe('authStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
  });

  it('starts unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it('login sets token and user', () => {
    vi.spyOn(storage, 'set').mockImplementation(() => {});
    useAuthStore.getState().login('token-123', mockUser);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('token-123');
    expect(state.user).toEqual(mockUser);
  });

  it('login persists to storage', () => {
    const setSpy = vi.spyOn(storage, 'set').mockImplementation(() => {});
    useAuthStore.getState().login('token-123', mockUser);

    expect(setSpy).toHaveBeenCalledWith('token-123', mockUser);
  });

  it('logout clears state and storage', () => {
    vi.spyOn(storage, 'set').mockImplementation(() => {});
    const clearSpy = vi.spyOn(storage, 'clear').mockImplementation(() => {});

    useAuthStore.getState().login('token-123', mockUser);
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('loadSession restores from storage', () => {
    vi.spyOn(storage, 'get').mockReturnValue({ token: 'restored-token', user: mockUser });

    useAuthStore.getState().loadSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('restored-token');
    expect(state.user?.login).toBe('testuser');
  });

  it('loadSession does nothing with empty storage', () => {
    vi.spyOn(storage, 'get').mockReturnValue(null);

    useAuthStore.getState().loadSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
  });
});
