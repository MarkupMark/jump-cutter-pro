<script lang="ts">
  import type { TelemetryMessage } from '@/entry-points/content/AllMediaElementsController';
  import { getMessage, getUiLanguage, UiLanguage } from '@/helpers/getMessage';
  import type { Settings } from '@/settings';
  import { tippyActionAsyncPreload as tippy } from './tippyAction';

  export let latestTelemetryRecord: Pick<TelemetryMessage, 'lifetimeTimeSaved'> | undefined;
  export let settings: Pick<Settings, 'lifetimeTimeSavedComparedToSoundedSpeed'>;
  export let onResetTimeSaved: () => void;

  const labels: Record<UiLanguage, {
    minute: string,
    minutes: string,
    hour: string,
    hours: string,
  }> = {
    en: { minute: 'minute saved', minutes: 'minutes saved', hour: 'hour saved', hours: 'hours saved' },
    it: { minute: 'minuto risparmiato', minutes: 'minuti risparmiati', hour: 'ora risparmiata', hours: 'ore risparmiate' },
    fr: { minute: 'minute économisée', minutes: 'minutes économisées', hour: 'heure économisée', hours: 'heures économisées' },
    es: { minute: 'minuto ahorrado', minutes: 'minutos ahorrados', hour: 'hora ahorrada', hours: 'horas ahorradas' },
  };
  const locales: Record<UiLanguage, string> = { en: 'en-GB', it: 'it-IT', fr: 'fr-FR', es: 'es-ES' };
  const language = getUiLanguage();
  const numberFormatter = new Intl.NumberFormat(locales[language], { maximumFractionDigits: 1 });

  function formatSavedTime(seconds: number) {
    const useHours = seconds >= 60 * 60;
    const value = useHours ? seconds / (60 * 60) : seconds / 60;
    const rounded = Math.round(value * 10) / 10;
    const unit = useHours
      ? rounded === 1 ? labels[language].hour : labels[language].hours
      : rounded === 1 ? labels[language].minute : labels[language].minutes;
    return `${numberFormatter.format(rounded)} ${unit}`;
  }

  $: savedSeconds = Math.max(
    0,
    latestTelemetryRecord?.lifetimeTimeSaved.timeSavedComparedToSoundedSpeed
      ?? settings.lifetimeTimeSavedComparedToSoundedSpeed,
  );
  $: summary = formatSavedTime(savedSeconds);
</script>

<div class="summary">
  <button
    class="value"
    type="button"
    use:tippy={{
      content: () => getMessage('timeSavedSinceInstallation'),
      theme: 'my-tippy',
      placement: 'bottom',
    }}
  >{summary}</button>
  <button
    class="reset"
    type="button"
    aria-label={getMessage('resetTimeSaved')}
    title={getMessage('resetTimeSaved')}
    on:click={onResetTimeSaved}
  >↻</button>
</div>

<style>
  .summary { display: inline-flex; align-items: center; gap: 0.25rem; }
  button { border: 0; background: transparent; }
  .value { padding: 0.2rem 0.25rem; font-weight: 650; white-space: nowrap; }
  .reset { min-width: 1.45rem; min-height: 1.45rem; padding: 0; color: var(--popup-muted); }
</style>
