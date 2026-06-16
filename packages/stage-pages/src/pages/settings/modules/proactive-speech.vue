<script setup lang="ts">
import { useProactiveSpeechStore } from '@proj-airi/stage-ui/stores/modules/proactive-speech'
import { useSettingsProactiveSpeech } from '@proj-airi/stage-ui/stores/settings/proactive-speech'
import { FieldCheckbox, FieldRange, FieldTextArea } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const settings = useSettingsProactiveSpeech()
const proactiveStore = useProactiveSpeechStore()

const {
  enabled,
  intervalMinMs,
  intervalMaxMs,
  promptTemplate,
  systemPromptOverride,
  maxTokens,
} = storeToRefs(settings)
const { isRunning, isThinking, lastTriggeredAt, lastError } = storeToRefs(proactiveStore)

const intervalMinMinutes = computed<number>({
  get: () => Math.round(intervalMinMs.value / 60_000),
  set: v => intervalMinMs.value = Math.max(0, v) * 60_000,
})
const intervalMaxMinutes = computed<number>({
  get: () => Math.round(intervalMaxMs.value / 60_000),
  set: v => intervalMaxMs.value = Math.max(0, v) * 60_000,
})

const statusLabel = computed(() => {
  if (!enabled.value)
    return t('settings.pages.modules.proactive-speech.sections.section.runtime.status.stopped')
  if (isThinking.value)
    return t('settings.pages.modules.proactive-speech.sections.section.runtime.status.thinking')
  return t('settings.pages.modules.proactive-speech.sections.section.runtime.status.running')
})

const lastTriggeredLabel = computed(() => {
  if (lastTriggeredAt.value === null)
    return t('settings.pages.modules.proactive-speech.sections.section.runtime.last-triggered.never')
  const d = new Date(lastTriggeredAt.value)
  const p = (v: number) => v.toString().padStart(2, '0')
  return t('settings.pages.modules.proactive-speech.sections.section.runtime.last-triggered.at', {
    timestamp: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  })
})

const lastErrorLabel = computed(() => {
  if (!lastError.value)
    return t('settings.pages.modules.proactive-speech.sections.section.runtime.last-error.none')
  return t('settings.pages.modules.proactive-speech.sections.section.runtime.last-error.at', { message: lastError.value })
})

function triggerNow() {
  void proactiveStore.trigger()
}
</script>

<template>
  <div bg="neutral-50 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-6">
    <header>
      <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
        {{ t('settings.pages.modules.proactive-speech.title') }}
      </h2>
      <p class="text-sm text-neutral-400 dark:text-neutral-500">
        {{ t('settings.pages.modules.proactive-speech.description') }}
      </p>
    </header>

    <section flex="~ col gap-4">
      <h3 class="text-base md:text-xl">
        {{ t('settings.pages.modules.proactive-speech.sections.section.schedule.title') }}
      </h3>
      <FieldCheckbox
        v-model="enabled"
        :label="t('settings.pages.modules.proactive-speech.sections.section.schedule.enabled.title')"
        :description="t('settings.pages.modules.proactive-speech.sections.section.schedule.enabled.description')"
      />
      <FieldRange
        v-model="intervalMinMinutes" :min="1" :max="60" :step="1"
        :label="t('settings.pages.modules.proactive-speech.sections.section.schedule.interval-min.title')"
        :description="t('settings.pages.modules.proactive-speech.sections.section.schedule.interval-min.description')"
      />
      <FieldRange
        v-model="intervalMaxMinutes" :min="1" :max="60" :step="1"
        :label="t('settings.pages.modules.proactive-speech.sections.section.schedule.interval-max.title')"
        :description="t('settings.pages.modules.proactive-speech.sections.section.schedule.interval-max.description')"
      />
      <FieldRange
        v-model.number="maxTokens" :min="16" :max="1024" :step="16"
        :label="t('settings.pages.modules.proactive-speech.sections.section.schedule.max-tokens.title')"
        :description="t('settings.pages.modules.proactive-speech.sections.section.schedule.max-tokens.description')"
      />
    </section>

    <section flex="~ col gap-4">
      <h3 class="text-base md:text-xl">
        {{ t('settings.pages.modules.proactive-speech.sections.section.prompt.title') }}
      </h3>
      <FieldTextArea
        v-model="promptTemplate" :rows="4"
        :label="t('settings.pages.modules.proactive-speech.sections.section.prompt.template.title')"
        :description="t('settings.pages.modules.proactive-speech.sections.section.prompt.template.description')"
      />
      <FieldTextArea
        v-model="systemPromptOverride" :rows="6"
        :label="t('settings.pages.modules.proactive-speech.sections.section.prompt.system-prompt-override.title')"
        :description="t('settings.pages.modules.proactive-speech.sections.section.prompt.system-prompt-override.description')"
      />
    </section>

    <section flex="~ col gap-3">
      <h3 class="text-base md:text-xl">
        {{ t('settings.pages.modules.proactive-speech.sections.section.runtime.title') }}
      </h3>

      <div flex="~ row items-center gap-2" text="sm">
        <span :class="['inline-block h-2 w-2 rounded-full', enabled ? 'bg-green-500' : 'bg-neutral-400', isThinking ? 'animate-pulse' : '']" />
        <span class="font-medium">{{ statusLabel }}</span>
        <span v-if="isRunning" text="neutral-400 dark:neutral-500">·</span>
        <span v-if="isRunning" text="neutral-400 dark:neutral-500">{{ lastTriggeredLabel }}</span>
      </div>

      <div text="sm neutral-400 dark:neutral-500">
        {{ lastErrorLabel }}
      </div>

      <button
        type="button" :disabled="isThinking"
        class="self-start border border-neutral-200 rounded-lg bg-white px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed dark:border-neutral-700 dark:bg-neutral-900 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
        @click="triggerNow"
      >
        {{ t('settings.pages.modules.proactive-speech.sections.section.runtime.trigger-now') }}
      </button>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.proactive-speech.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
