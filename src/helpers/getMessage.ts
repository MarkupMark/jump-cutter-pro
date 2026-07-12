/**
 * Runtime-selectable UI translations.
 *
 * Browser extension i18n normally follows the browser language and cannot be changed at runtime.
 * Keeping these four catalogs in the bundle lets the popup and options page honor the user's explicit choice.
 */
import englishMessages from '@/_locales/en/messages.json';
import italianMessages from '@/_locales/it/messages.json';
import frenchMessages from '@/_locales/fr/messages.json';
import spanishMessages from '@/_locales/es/messages.json';

export type UiLanguage = 'en' | 'it' | 'fr' | 'es';

type MessageEntry = {
  message: string,
  placeholders?: Record<string, { content: string }>,
};
type MessageCatalog = Record<string, MessageEntry>;

const catalogs: Record<UiLanguage, MessageCatalog> = {
  en: englishMessages,
  it: italianMessages,
  fr: frenchMessages,
  es: spanishMessages,
};

const labelOverrides: Record<UiLanguage, Record<string, string>> = {
  en: {
    volumeThreshold: 'Minimum audio threshold for speed-up',
    soundedSpeed: 'Standard playback speed',
    silenceSpeed: 'Silence playback speed',
  },
  it: {
    enable: 'Abilita',
    loading: 'Caricamento',
    popupAdvancedMode: 'Impostazioni avanzate',
    openLocalFile: 'Apri un file locale',
    skipLess: 'Velocizza meno',
    skipMore: 'Velocizza di più',
    absolute: 'assoluta',
    relativeToSounded: 'relativa alla velocità standard',
    marginBefore: 'Margine prima',
    marginAfter: 'Margine dopo',
    timeSaved: 'Tempo risparmiato',
    timeSavedSinceInstallation: 'Tempo totale risparmiato dall’installazione',
    resetTimeSaved: 'Azzera il tempo risparmiato',
    general: 'Generali',
    hotkeys: 'Scorciatoie da tastiera',
    popup: 'Finestra dell’estensione',
    chart: 'Grafico',
    iconBadge: 'Indicatore sull’icona',
    meta: 'Gestione impostazioni',
    saving: 'Salvataggio…',
    saved: 'Salvato',
    volumeThreshold: 'Soglia audio minima velocizzazione',
    soundedSpeed: 'Velocità di riproduzione standard',
    silenceSpeed: 'Velocità di riproduzione in silenzio',
  },
  fr: {
    volumeThreshold: "Seuil audio minimal d’accélération",
    soundedSpeed: 'Vitesse de lecture standard',
    silenceSpeed: 'Vitesse de lecture pendant les silences',
  },
  es: {
    volumeThreshold: 'Umbral mínimo de audio para aceleración',
    soundedSpeed: 'Velocidad de reproducción estándar',
    silenceSpeed: 'Velocidad de reproducción durante silencios',
  },
};

let activeUiLanguage: UiLanguage = 'en';

export function setUiLanguage(language: UiLanguage) {
  activeUiLanguage = language;
}

export function getUiLanguage(): UiLanguage {
  return activeUiLanguage;
}

function applySubstitutions(entry: MessageEntry, substitutions?: string | string[]): string {
  const values = substitutions === undefined
    ? []
    : Array.isArray(substitutions) ? substitutions : [substitutions];
  let message = entry.message;

  for (const [name, placeholder] of Object.entries(entry.placeholders ?? {})) {
    const replacement = placeholder.content.replace(/\$(\d+)/g, (_, index: string) => values[Number(index) - 1] ?? '');
    message = message.replace(new RegExp(`\\$${name}\\$`, 'gi'), replacement);
  }

  return message.replace(/\$\$/g, '$');
}

export function getMessage(messageName: string, substitutions?: string | string[]): string {
  const override = labelOverrides[activeUiLanguage][messageName];
  if (override) {
    return override;
  }

  const entry = catalogs[activeUiLanguage][messageName] ?? catalogs.en[messageName];
  return entry ? applySubstitutions(entry, substitutions) : messageName;
}
