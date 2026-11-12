import { describe, it, expect } from 'vitest';
import { isScience } from '../src/services/lessons/modules.js';
describe('Biology uses the science figure kinds', () => {
  it('treats Biology as a science subject', () => {
    expect(isScience({ name: 'Biology', code: 'BIO' })).toBe(true);
    expect(isScience({ name: 'General Science', code: 'S-GENSCI' })).toBe(true);
    expect(isScience({ name: 'Social Studies', code: 'SOC' })).toBe(false);
    expect(isScience({ name: 'Mathematics', code: 'MATH' })).toBe(false);
  });
});
