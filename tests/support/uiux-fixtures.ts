// Shared fixtures for the UI/UX tests (a valid DesignTokens object, plain JSON).
export const tokens = () => ({
  colors: {
    background: '#FFFFFF', surface: '#F5F5F7', text: '#1B1B1F', textMuted: '#5E5E6A', primary: '#2F5BEA', onPrimary: '#FFFFFF',
    border: '#DADAE0', success: '#1E8A55', warning: '#A86A00', danger: '#C9353A', info: '#2F80ED'
  },
  ratio: { background: 60, surface: 30, accent: 10 },
  shadows: { button: null, card: { x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.12 }, popover: { x: 0, y: 8, blur: 24, spread: 0, color: '#000000', opacity: 0.18 } },
  type: {
    heading: { family: 'Pretendard', fallback: 'Malgun Gothic, sans-serif', size: 24, weight: 700, lineHeight: 1.3 },
    body: { family: 'Pretendard', fallback: 'Malgun Gothic, sans-serif', size: 15, weight: 400, lineHeight: 1.6 },
    numeric: { family: 'Roboto Mono', fallback: 'Consolas, monospace', size: 14, weight: 500, lineHeight: 1.4 }
  },
  box: { radius: 8, paddingX: 16, paddingY: 10, gap: 12, density: 'comfortable' }
})
