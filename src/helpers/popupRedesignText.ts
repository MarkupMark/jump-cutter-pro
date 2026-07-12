import { getUiLanguage, UiLanguage } from '@/helpers/getMessage';

const texts = {
  en: {
    chartZoom: 'Chart zoom',
    chartZoomMinSeconds: 'Maximum zoom (minimum visible seconds)',
    chartZoomMaxSeconds: 'Minimum zoom (maximum visible seconds)',
    jumpCutControls: 'Jump cutting',
    marginPreviewTitle: 'How margins change the cut',
    before: 'Before', after: 'After', detectedSilence: 'detected silence',
    decreaseSpeed: 'Decrease video speed', increaseSpeed: 'Increase video speed',
    language: 'Language', settings: 'Settings',
  },
  it: {
    chartZoom: 'Zoom del grafico',
    chartZoomMinSeconds: 'Zoom massimo (secondi visibili minimi)',
    chartZoomMaxSeconds: 'Zoom minimo (secondi visibili massimi)',
    jumpCutControls: 'Jump cutting',
    marginPreviewTitle: 'Come cambiano i tagli',
    before: 'Prima', after: 'Dopo', detectedSilence: 'silenzio rilevato',
    decreaseSpeed: 'Riduci la velocità video', increaseSpeed: 'Aumenta la velocità video',
    language: 'Lingua', settings: 'Impostazioni',
  },
  fr: {
    chartZoom: 'Zoom du graphique',
    chartZoomMinSeconds: 'Zoom maximal (secondes visibles minimales)',
    chartZoomMaxSeconds: 'Zoom minimal (secondes visibles maximales)',
    jumpCutControls: 'Coupure des silences',
    marginPreviewTitle: 'Effet des marges sur la coupure',
    before: 'Avant', after: 'Après', detectedSilence: 'silence détecté',
    decreaseSpeed: 'Réduire la vitesse vidéo', increaseSpeed: 'Augmenter la vitesse vidéo',
    language: 'Langue', settings: 'Paramètres',
  },
  es: {
    chartZoom: 'Zoom del gráfico',
    chartZoomMinSeconds: 'Zoom máximo (segundos visibles mínimos)',
    chartZoomMaxSeconds: 'Zoom mínimo (segundos visibles máximos)',
    jumpCutControls: 'Corte de silencios',
    marginPreviewTitle: 'Cómo cambian los márgenes el corte',
    before: 'Antes', after: 'Después', detectedSilence: 'silencio detectado',
    decreaseSpeed: 'Reducir la velocidad del vídeo', increaseSpeed: 'Aumentar la velocidad del vídeo',
    language: 'Idioma', settings: 'Ajustes',
  },
} satisfies Record<UiLanguage, Record<string, string>>;

export function getPopupRedesignText() {
  return texts[getUiLanguage()];
}
