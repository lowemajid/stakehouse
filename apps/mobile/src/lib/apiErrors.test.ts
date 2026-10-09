import { describe, expect, it } from 'vitest';
import { ApiError } from '@stakehouse/api-client';
import { apiErrorMessage } from './apiErrors';

describe('apiErrorMessage', () => {
  it('passes the server envelope message through', () => {
    const error = new ApiError(400, 'league-full', 'That league is full.');
    expect(apiErrorMessage(error)).toBe('That league is full.');
  });

  it('translates network failures into plain guidance', () => {
    const error = new ApiError(0, 'network-error', 'network failure calling /api/leagues');
    expect(apiErrorMessage(error)).toContain('unreachable');
  });

  it('falls back to neutral copy for unknown throwables', () => {
    expect(apiErrorMessage(new Error('boom'))).toContain('Something went wrong');
    expect(apiErrorMessage(undefined)).toContain('Something went wrong');
  });
});
