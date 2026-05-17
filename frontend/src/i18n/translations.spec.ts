import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLang, getLang } from './translations';

describe('i18n', () => {
  beforeEach(() => {
    setLang('zh');
  });

  describe('t()', () => {
    it('returns Chinese by default', () => {
      expect(t('nav.files')).toBe('我的文件');
      expect(t('auth.login')).toBe('登录');
    });

    it('returns English after setLang("en")', () => {
      setLang('en');
      expect(t('nav.files')).toBe('My Files');
      expect(t('auth.login')).toBe('Login');
    });

    it('falls back to zh for unknown lang', () => {
      setLang('fr');
      expect(t('nav.files')).toBe('我的文件');
    });

    it('falls back to key for unknown key', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('interpolates params', () => {
      expect(t('toolbar.selected', { n: 5 })).toBe('已选 5 项');
      expect(t('toolbar.selected', { n: 3 })).toBe('已选 3 项');
    });

    it('returns param key if no value provided', () => {
      expect(t('toolbar.count', { n: 10 })).toBe('共 10 个项目');
    });

    it('handles multiple params', () => {
      setLang('en');
      expect(t('login.welcomeBack', { name: 'Alice' })).toBe('Welcome back, Alice!');
    });
  });

  describe('setLang / getLang', () => {
    it('getLang returns current', () => {
      expect(getLang()).toBe('zh');
      setLang('en');
      expect(getLang()).toBe('en');
    });

    it('ignores unsupported lang', () => {
      setLang('jp');
      expect(getLang()).toBe('zh');
    });
  });
});
