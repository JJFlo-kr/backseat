// Single source of truth for public links and app identity. The app (tray, About window)
// imports this file; README.md repeats the same values, so when a link changes, change it
// here and in the README badge/links.
export const APP_NAME = 'Backseat'
export const APP_TAGLINE = 'AI 소통기 — 화면을 캡처해 짚고 말하면 AI 코딩 에이전트가 이어서 작업합니다.'

// TODO(release): replace REPLACE_ME values after creating the GitHub repository / donation page.
export const REPO_URL = 'https://github.com/JJFlo-kr/backseat'
export const ISSUES_URL = `${REPO_URL}/issues`

/** Voluntary support page (Buy Me a Coffee). */
export const SUPPORT_URL = 'https://buymeacoffee.com/REPLACE_ME'
/** Optional alternative support page (Ko-fi); empty = not used. */
export const KOFI_URL = ''

export const LICENSE_NAME = 'MIT'
