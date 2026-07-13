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
    resetTimeSaved: 'Reset time saved for this video',
    timeSavedCurrentVideo: 'Time saved on the current video',
    detachPopup: 'Open in a separate window',
    interactionsWithOtherScripts: 'Interactions with other scripts',
    allowOtherExtensionsPlaybackControl: 'Allow other extensions to control playback speed',
    supportMe: 'Support me',
    playbackBehavior: 'Playback behavior',
    rangeSlidersAttributesNote: 'The extension limits silence playback to a maximum of 8×. Configure the minimum, maximum, and step used by the popup sliders.',
    reloadForLoudnessAnalysis: 'Reload the page to restart loudness analysis',
    reloadPage: 'Reload',
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
    timeSavedCurrentVideo: 'Tempo risparmiato nel video corrente',
    detachPopup: 'Apri in una finestra separata',
    interactionsWithOtherScripts: 'Interazioni con altri script',
    allowOtherExtensionsPlaybackControl: 'Permetti anche ad altre estensioni di controllare la velocità di riproduzione',
    supportMe: 'Supportami',
    playbackBehavior: 'Comportamento della riproduzione',
    rangeSlidersAttributesNote: 'L’estensione limita la riproduzione in silenzio a un massimo di 8×. Imposta il valore minimo, massimo e l’incremento dei cursori mostrati nella finestra dell’estensione.',
    reloadForLoudnessAnalysis: 'Ricarica la pagina per riavviare l’analisi del volume',
    reloadPage: 'Ricarica',
  },
  fr: {
    volumeThreshold: "Seuil audio minimal d’accélération",
    soundedSpeed: 'Vitesse de lecture standard',
    silenceSpeed: 'Vitesse de lecture pendant les silences',
    resetTimeSaved: 'Réinitialiser le temps économisé pour cette vidéo',
    timeSavedCurrentVideo: 'Temps économisé sur la vidéo en cours',
    timeSavedSinceInstallation: "Temps total économisé depuis l’installation",
    detachPopup: 'Ouvrir dans une fenêtre séparée',
    interactionsWithOtherScripts: 'Interactions avec les autres scripts',
    allowOtherExtensionsPlaybackControl: 'Autoriser les autres extensions à contrôler la vitesse de lecture',
    supportMe: 'Me soutenir',
    playbackBehavior: 'Comportement de lecture',
    rangeSlidersAttributesNote: 'L’extension limite la lecture pendant les silences à un maximum de 8×. Configurez les valeurs minimale et maximale ainsi que le pas des curseurs de la fenêtre.',
    reloadForLoudnessAnalysis: "Rechargez la page pour relancer l’analyse du volume",
    reloadPage: 'Recharger',
    enableDesyncCorrection: 'Corriger automatiquement la désynchronisation audio-vidéo',
    muteSilences: 'Couper le son pendant les silences',
    transientNoiseFilterEnabled: 'Filtre des bruits transitoires',
    transientNoiseFilterEnabledTooltip: 'Ignore les sons forts très brefs afin qu’ils n’interrompent pas l’accélération des silences.',
    transientNoiseFilterMinSoundedDurationMs: 'Durée sonore minimale (ms)',
    transientNoiseFilterMinSoundedDurationMsTooltip: 'Les sons plus courts que cette valeur sont ignorés. Valeur par défaut : 30 ms.',
  },
  es: {
    volumeThreshold: 'Umbral mínimo de audio para aceleración',
    soundedSpeed: 'Velocidad de reproducción estándar',
    silenceSpeed: 'Velocidad de reproducción durante silencios',
    resetTimeSaved: 'Restablecer el tiempo ahorrado para este vídeo',
    timeSavedCurrentVideo: 'Tiempo ahorrado en el vídeo actual',
    timeSavedSinceInstallation: 'Tiempo total ahorrado desde la instalación',
    detachPopup: 'Abrir en una ventana separada',
    interactionsWithOtherScripts: 'Interacciones con otros scripts',
    allowOtherExtensionsPlaybackControl: 'Permitir que otras extensiones controlen la velocidad de reproducción',
    supportMe: 'Apóyame',
    playbackBehavior: 'Comportamiento de reproducción',
    rangeSlidersAttributesNote: 'La extensión limita la reproducción durante los silencios a un máximo de 8×. Configura los valores mínimo y máximo y el incremento de los controles de la ventana.',
    reloadForLoudnessAnalysis: 'Recarga la página para reiniciar el análisis del volumen',
    reloadPage: 'Recargar',
    muteSilences: 'Silenciar durante los silencios',
    transientNoiseFilterEnabled: 'Filtro de ruidos transitorios',
    transientNoiseFilterEnabledTooltip: 'Ignora sonidos fuertes muy breves para que no interrumpan la aceleración de los silencios.',
    transientNoiseFilterMinSoundedDurationMs: 'Duración mínima del sonido (ms)',
    transientNoiseFilterMinSoundedDurationMsTooltip: 'Los sonidos más cortos que este valor se ignoran. Valor predeterminado: 30 ms.',
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
