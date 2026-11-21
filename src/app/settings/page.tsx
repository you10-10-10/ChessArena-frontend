'use client';

import { useI18n } from '@/lib/i18n/context';
import { isLanguage } from '@/lib/i18n/translations';
import { Globe, Monitor } from 'lucide-react';
import { useState } from 'react';
import { BOARD_THEMES, getBoardTheme, setBoardTheme, type BoardThemeId } from '@/lib/boardThemes';

export default function SettingsPage() {
  const { language, setLanguage, t, tr } = useI18n();
  const [boardTheme, updateBoardTheme] = useState<BoardThemeId>(getBoardTheme().id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 text-text-primary">
      <header className="mb-8">
        <h1 className="text-3xl font-bold md:text-4xl">{t('settingsTitle')}</h1>
        <p className="mt-1 text-text-secondary">{tr('Customize your language preference, board themes, and sound settings.')}</p>
      </header>

      <div className="space-y-6">
        {/* Language Settings */}
        <div className="bg-background-secondary rounded-2xl p-6 border border-text-secondary/15 shadow-card">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-accent" />
            {tr('Language & Region (اللغة والمنطقة)')}
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            {tr('Select your preferred platform language. ChessArena instantly translates all menus, pages, and components.')}
          </p>
          <div className="max-w-xs">
            <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">
              {t('language')}
            </label>
            <select
              value={language}
              onChange={(event) => {
                const selectedLanguage = event.currentTarget.value;
                if (isLanguage(selectedLanguage)) setLanguage(selectedLanguage);
              }}
              className="w-full rounded-xl border border-text-secondary/20 bg-background-tertiary px-4 py-3 text-text-primary font-semibold"
            >
              <option value="en">{tr('English (LTR)')}</option>
              <option value="fr">{tr('Français (LTR)')}</option>
              <option value="ar">{tr('العربية (RTL)')}</option>
            </select>
          </div>
        </div>

        {/* Board & Audio Preferences */}
        <div className="bg-background-secondary rounded-2xl p-6 border border-text-secondary/15 shadow-card">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Monitor className="w-5 h-5 text-accent" />
            {tr('Board & Sound Preferences')}
          </h2>
          <div className="space-y-4">
            <div>
              <p className="mb-3 text-sm font-medium">{tr('Board Theme')}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {BOARD_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    aria-pressed={boardTheme === theme.id}
                    onClick={() => {
                      updateBoardTheme(theme.id);
                      setBoardTheme(theme.id);
                    }}
                    className={`rounded-xl border p-3 text-start ${boardTheme === theme.id ? 'border-accent ring-2 ring-accent/30' : 'border-text-secondary/20'}`}
                  >
                    <span className="mb-2 grid grid-cols-2 overflow-hidden rounded-lg">
                      <span className="h-7" style={{ background: theme.light }} />
                      <span className="h-7" style={{ background: theme.dark }} />
                    </span>
                    <span className="text-xs font-semibold">{theme.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between p-3 bg-background-tertiary rounded-xl border border-text-secondary/10">
              <span className="text-sm font-medium">{tr('Enable Move Sounds')}</span>
              <input type="checkbox" defaultChecked className="w-4 h-4 accent-accent" />
            </label>
            <label className="flex items-center justify-between p-3 bg-background-tertiary rounded-xl border border-text-secondary/10">
              <span className="text-sm font-medium">{tr('Dark Mode Appearance')}</span>
              <input type="checkbox" defaultChecked disabled className="w-4 h-4 accent-accent" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
