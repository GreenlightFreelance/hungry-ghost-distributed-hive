import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { storage, useAuthStore } from '../stores/authStore';

const mockUser = {
  login: 'testuser',
  avatarUrl: 'https://avatar.url',
  name: 'Test User',
};

function renderApp(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>
  );
}

describe('App routing', () => {
  beforeEach(() => {
    vi.spyOn(storage, 'get').mockReturnValue(null);
    vi.spyOn(storage, 'set').mockImplementation(() => {});
    vi.spyOn(storage, 'clear').mockImplementation(() => {});
    useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
  });

  it('redirects to login when not authenticated', () => {
    renderApp('/');
    expect(screen.getByText('Sign in to access the dashboard')).toBeInTheDocument();
  });

  it('renders login page at /login', () => {
    renderApp('/login');
    expect(screen.getByText('Distributed Hive')).toBeInTheDocument();
    expect(screen.getByText('Sign in to access the dashboard')).toBeInTheDocument();
  });

  it('renders dashboard at / when authenticated', () => {
    useAuthStore.getState().login('token', mockUser);
    renderApp('/');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Active Runs')).toBeInTheDocument();
  });

  it('renders submit run page at /submit when authenticated', () => {
    useAuthStore.getState().login('token', mockUser);
    renderApp('/submit');
    expect(screen.getByRole('heading', { name: 'New Run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Run' })).toBeInTheDocument();
  });

  it('renders run view at /run/:id when authenticated', () => {
    useAuthStore.getState().login('token', mockUser);
    renderApp('/run/test-123');
    expect(screen.getByText(/Loading run/)).toBeInTheDocument();
  });

  it('renders settings at /settings when authenticated', () => {
    useAuthStore.getState().login('token', mockUser);
    renderApp('/settings');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('renders navigation links when authenticated', () => {
    useAuthStore.getState().login('token', mockUser);
    renderApp('/');
    expect(screen.getByText('Distributed Hive')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New Run' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows user info and sign out in header when authenticated', () => {
    useAuthStore.getState().login('token', mockUser);
    renderApp('/');
    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    expect(screen.getByAltText('testuser')).toBeInTheDocument();
  });

  it('renders auth callback at /auth/callback', () => {
    renderApp('/auth/callback');
    // Without a code param, it shows an error
    expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
  });
});
