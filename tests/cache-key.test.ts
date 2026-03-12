import { describe, it, expect } from 'vitest';
import { shouldSkipCache } from '../src/lib/cache-key';

describe('shouldSkipCache', () => {
  it('returns true for queries with "today"', () => {
    expect(shouldSkipCache('What is today\'s exchange rate?')).toBe(true);
  });

  it('returns true for queries with "current"', () => {
    expect(shouldSkipCache('What is the current minimum wage?')).toBe(true);
  });

  it('returns true for queries with "latest"', () => {
    expect(shouldSkipCache('Show me the latest procurement rules')).toBe(true);
  });

  it('returns true for queries with "now"', () => {
    expect(shouldSkipCache('What should I do now?')).toBe(true);
  });

  it('returns true for queries with "2026"', () => {
    expect(shouldSkipCache('What are the 2026 WASSCE dates?')).toBe(true);
  });

  it('returns true for queries with "recent"', () => {
    expect(shouldSkipCache('Show recent audit findings')).toBe(true);
  });

  it('returns false for static/historical queries', () => {
    expect(shouldSkipCache('What is the procurement act?')).toBe(false);
  });

  it('returns false for general knowledge queries', () => {
    expect(shouldSkipCache('Explain the SSNIT contribution structure')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(shouldSkipCache('WHAT IS THE LATEST NEWS?')).toBe(true);
  });
});
