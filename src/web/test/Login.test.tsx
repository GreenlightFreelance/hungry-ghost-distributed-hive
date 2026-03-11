import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Login } from '../pages/Login';

describe('Login page', () => {
  beforeEach(() => {
    import.meta.env.VITE_GITHUB_CLIENT_ID = 'test-id';
  });

  afterEach(() => {
    delete import.meta.env.VITE_GITHUB_CLIENT_ID;
  });

  it('renders sign-in heading', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    expect(screen.getByText('Distributed Hive')).toBeInTheDocument();
    expect(screen.getByText('Sign in to access the dashboard')).toBeInTheDocument();
  });

  it('shows GitHub sign-in link when client ID is configured', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /sign in with github/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('github.com/login/oauth/authorize');
    expect(link.getAttribute('href')).toContain('client_id=test-id');
  });

  it('shows error when client ID is not configured', () => {
    delete import.meta.env.VITE_GITHUB_CLIENT_ID;

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });
});
