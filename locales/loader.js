'use strict';

// ─── i18n Locale Loader ─────────────────────────────────────────────────────
// Provides t(key, params) for string lookup with template interpolation.
// Loaded before all other JS in index.html.

const _locales = {};
let _currentLocale = 'en';

function registerLocale(lang, strings) {
  _locales[lang] = strings;
}

function setLocale(lang) {
  if (_locales[lang]) {
    _currentLocale = lang;
    localStorage.setItem('maze-lang', lang);
    // Apply data-i18n attributes in DOM
    _applyDomI18n();
  }
}

function getLocale() {
  return _currentLocale;
}

/**
 * Translate a key with optional parameter interpolation.
 * t('hello', { name: 'world' }) → looks up key, replaces {name} with 'world'
 * Falls back to zh if key missing in current locale, then to key itself.
 */
function t(key, params) {
  let str = (_locales[_currentLocale] && _locales[_currentLocale][key])
         || (_locales.zh && _locales.zh[key])
         || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return str;
}

/**
 * Apply translations to all elements with data-i18n attribute.
 * <span data-i18n="boot.agent">连接 Agent</span> → t('boot.agent')
 */
function _applyDomI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });
  // Update page title
  const titleKey = document.documentElement.getAttribute('data-i18n-title');
  if (titleKey) document.title = t(titleKey);
}

/**
 * Initialize locale from localStorage or browser language.
 * Call after all locale files are registered.
 */
function initLocale() {
  const saved = localStorage.getItem('maze-lang');
  if (saved && _locales[saved]) {
    _currentLocale = saved;
  } else {
    // Auto-detect from browser
    const browserLang = (navigator.language || '').slice(0, 2);
    _currentLocale = _locales[browserLang] ? browserLang : 'en';
  }
  _applyDomI18n();
}
