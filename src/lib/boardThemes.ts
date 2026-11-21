export type BoardThemeId = 'green' | 'brown' | 'blue' | 'purple' | 'gray' | 'orange';

export const BOARD_THEMES: readonly { id: BoardThemeId; name: string; light: string; dark: string }[] = [
  { id: 'green', name: 'Classic Green', light: '#EEEED2', dark: '#769656' },
  { id: 'brown', name: 'Walnut', light: '#F0D9B5', dark: '#B58863' },
  { id: 'blue', name: 'Ocean Blue', light: '#DEE8F2', dark: '#4F7CAC' },
  { id: 'purple', name: 'Royal Purple', light: '#EEE6F7', dark: '#8067A8' },
  { id: 'gray', name: 'Modern Gray', light: '#E8E9EA', dark: '#7D8791' },
  { id: 'orange', name: 'Copper', light: '#F2DFC4', dark: '#C88B52' },
];

export function getBoardTheme(): typeof BOARD_THEMES[number] {
  if (typeof window === 'undefined') return BOARD_THEMES[0];
  const stored = window.localStorage.getItem('chessarena_board_theme');
  return BOARD_THEMES.find((theme) => theme.id === stored) ?? BOARD_THEMES[0];
}

export function setBoardTheme(themeId: BoardThemeId): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('chessarena_board_theme', themeId);
  }
}
