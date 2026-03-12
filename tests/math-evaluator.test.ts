import { describe, it, expect } from 'vitest';
import { safeEvaluate } from '../src/lib/tool-executor';

describe('safeEvaluate — recursive descent math parser', () => {
  // Basic arithmetic
  it('adds two numbers', () => {
    expect(safeEvaluate('2 + 3')).toBe(5);
  });

  it('subtracts two numbers', () => {
    expect(safeEvaluate('10 - 4')).toBe(6);
  });

  it('multiplies two numbers', () => {
    expect(safeEvaluate('3 * 7')).toBe(21);
  });

  it('divides two numbers', () => {
    expect(safeEvaluate('20 / 5')).toBe(4);
  });

  it('handles modulo', () => {
    expect(safeEvaluate('10 % 3')).toBe(1);
  });

  // Operator precedence
  it('respects operator precedence: 2 + 3 * 4 = 14', () => {
    expect(safeEvaluate('2 + 3 * 4')).toBe(14);
  });

  it('respects operator precedence: 10 - 2 * 3 = 4', () => {
    expect(safeEvaluate('10 - 2 * 3')).toBe(4);
  });

  // Parentheses
  it('handles parentheses: (2 + 3) * 4 = 20', () => {
    expect(safeEvaluate('(2 + 3) * 4')).toBe(20);
  });

  it('handles nested parentheses: ((2 + 3) * (4 - 1))', () => {
    expect(safeEvaluate('((2 + 3) * (4 - 1))')).toBe(15);
  });

  // Power
  it('handles exponentiation: 2 ^ 3 = 8', () => {
    expect(safeEvaluate('2 ^ 3')).toBe(8);
  });

  it('handles power with precedence: 2 + 3 ^ 2 = 11', () => {
    expect(safeEvaluate('2 + 3 ^ 2')).toBe(11);
  });

  // Unary minus
  it('handles unary minus: -5 + 3 = -2', () => {
    expect(safeEvaluate('-5 + 3')).toBe(-2);
  });

  it('handles double unary minus: --5 = 5', () => {
    expect(safeEvaluate('--5')).toBe(5);
  });

  // Decimals
  it('handles decimal numbers: 3.14 * 2', () => {
    expect(safeEvaluate('3.14 * 2')).toBeCloseTo(6.28);
  });

  // Complex expressions
  it('evaluates complex expression: (100 + 50) * 0.175', () => {
    expect(safeEvaluate('(100 + 50) * 0.175')).toBeCloseTo(26.25);
  });

  // Error cases
  it('throws on division by zero', () => {
    expect(() => safeEvaluate('10 / 0')).toThrow('Division by zero');
  });

  it('throws on invalid characters', () => {
    expect(() => safeEvaluate('abc')).toThrow('Invalid character');
  });

  it('throws on missing closing parenthesis', () => {
    expect(() => safeEvaluate('(2 + 3')).toThrow('Missing closing parenthesis');
  });

  it('throws on empty expression', () => {
    expect(() => safeEvaluate('')).toThrow();
  });

  // GHS salary calculation scenario
  it('computes SSNIT contribution: 5000 * 0.055 = 275', () => {
    expect(safeEvaluate('5000 * 0.055')).toBeCloseTo(275);
  });
});
