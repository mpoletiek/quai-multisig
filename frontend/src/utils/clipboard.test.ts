import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyToClipboard, useCopyToClipboard } from './clipboard';

describe('clipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('copyToClipboard', () => {
    it('should copy text using navigator.clipboard', async () => {
      const text = 'test text to copy';
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      const result = await copyToClipboard(text);

      expect(result).toBe(true);
      expect(writeTextSpy).toHaveBeenCalledWith(text);
    });

    it('should use fallback when clipboard API fails', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Not supported'));

      // The fallback creates a textarea element, so we spy on createElement
      const createElementSpy = vi.spyOn(document, 'createElement');

      const result = await copyToClipboard('test');

      // Fallback should have created a textarea
      expect(createElementSpy).toHaveBeenCalledWith('textarea');
      // The function should return true since the fallback completes
      expect(result).toBe(true);
    });

    it('should handle empty string', async () => {
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      const result = await copyToClipboard('');

      expect(result).toBe(true);
      expect(writeTextSpy).toHaveBeenCalledWith('');
    });

    it('should handle long text', async () => {
      const longText = 'a'.repeat(10000);
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      const result = await copyToClipboard(longText);

      expect(result).toBe(true);
      expect(writeTextSpy).toHaveBeenCalledWith(longText);
    });

    it('should handle special characters', async () => {
      const specialText = '!@#$%^&*()_+{}|:"<>?`~[]\\;\',./';
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      const result = await copyToClipboard(specialText);

      expect(result).toBe(true);
      expect(writeTextSpy).toHaveBeenCalledWith(specialText);
    });
  });

  describe('useCopyToClipboard', () => {
    it('should return a function that copies to clipboard', async () => {
      const copyFn = useCopyToClipboard();
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      const result = await copyFn('test text');

      expect(result).toBe(true);
      expect(writeTextSpy).toHaveBeenCalledWith('test text');
    });
  });
});
