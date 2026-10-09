// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@stakehouse/api-client';
import { ApiProvider } from '../state/ApiContext';
import { makeFakeApi } from '../test/api';
import { SessionProvider } from './SessionContext';
import { SignInForm } from './SignInForm';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function renderForm(onSuccess: () => void = vi.fn(), api = makeFakeApi()) {
  return render(
    <ApiProvider api={api}>
      <SessionProvider>
        <SignInForm onSuccess={onSuccess} />
      </SessionProvider>
    </ApiProvider>,
  );
}

describe('SignInForm', () => {
  it('demands a display name and a valid email before calling the API', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderForm(vi.fn(), api);
    await user.click(screen.getByRole('button', { name: /take my seat/i }));
    expect(await screen.findByText('display name is required')).toBeInTheDocument();
    expect(await screen.findByText('a valid email is required')).toBeInTheDocument();
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('rejects a malformed email client-side', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderForm(vi.fn(), api);
    await user.type(screen.getByLabelText('Display name'), 'Marge');
    await user.type(screen.getByLabelText('Email'), 'marge@');
    await user.click(screen.getByRole('button', { name: /take my seat/i }));
    expect(await screen.findByText('a valid email is required')).toBeInTheDocument();
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('signs in and hands the user to onSuccess', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const api = makeFakeApi();
    renderForm(onSuccess, api);
    await user.type(screen.getByLabelText('Display name'), 'Marge Kowalski');
    await user.type(screen.getByLabelText('Email'), 'marge@example.com');
    await user.click(screen.getByRole('button', { name: /take my seat/i }));
    expect(api.createSession).toHaveBeenCalledWith({
      displayName: 'Marge Kowalski',
      email: 'marge@example.com',
    });
    expect(onSuccess).toHaveBeenCalledWith({
      displayName: 'Marge Kowalski',
      email: 'marge@example.com',
    });
  });

  it('shows the server rejection instead of dying silently', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      createSession: vi
        .fn()
        .mockRejectedValue(new ApiError(400, 'validation-error', 'a valid email is required')),
    });
    renderForm(vi.fn(), api);
    await user.type(screen.getByLabelText('Display name'), 'Marge');
    await user.type(screen.getByLabelText('Email'), 'marge@example.com');
    await user.click(screen.getByRole('button', { name: /take my seat/i }));
    expect(await screen.findByText('a valid email is required')).toBeInTheDocument();
  });
});
