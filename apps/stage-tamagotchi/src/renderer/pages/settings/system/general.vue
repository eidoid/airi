<script setup lang="ts">
import SettingsGeneralFields from '@proj-airi/stage-pages/components/settings-general-fields.vue'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useSettingsControlsIsland } from '@proj-airi/stage-ui/stores/settings'
import { FieldCheckbox } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { electron, electronAppIconGet, electronAppIconSet, electronInlayEnabledGet, electronInlayEnabledSet } from '../../../../shared/eventa'

const { t } = useI18n()
const getHidden = useElectronEventaInvoke(electronAppIconGet)
const setHidden = useElectronEventaInvoke(electronAppIconSet)
const isLinux = useElectronEventaInvoke(electron.app.isLinux)
// The value stays undefined on Linux, and the field does not show there.
const hideAppIcon = shallowRef<boolean>()
const getInlayEnabled = useElectronEventaInvoke(electronInlayEnabledGet)
const setInlayEnabled = useElectronEventaInvoke(electronInlayEnabledSet)
const inlayEnabled = shallowRef<boolean>()
const { autoHide } = storeToRefs(useSettingsControlsIsland())

onMounted(async () => {
  try {
    if (!await isLinux())
      hideAppIcon.value = await getHidden()
  }
  catch {
    toast.error(t('tamagotchi.settings.pages.system.general.hide-app-icon.load-error'))
  }
})

onMounted(async () => {
  try {
    inlayEnabled.value = await getInlayEnabled()
  }
  catch {
    toast.error(t('tamagotchi.settings.pages.system.general.inlay.load-error'))
  }
})

async function updateInlayEnabled(enabled: boolean) {
  try {
    inlayEnabled.value = await setInlayEnabled(enabled)
  }
  catch {
    toast.error(t('tamagotchi.settings.pages.system.general.inlay.save-error'))
  }
}

async function updateHidden(hidden: boolean) {
  try {
    hideAppIcon.value = await setHidden(hidden)
  }
  catch {
    toast.error(t('tamagotchi.settings.pages.system.general.hide-app-icon.save-error'))
  }
}
</script>

<template>
  <SettingsGeneralFields>
    <template #additional-fields>
      <FieldCheckbox
        v-if="inlayEnabled !== undefined"
        :model-value="inlayEnabled"
        :label="t('tamagotchi.settings.pages.system.general.inlay.title')"
        :description="t('tamagotchi.settings.pages.system.general.inlay.description')"
        @update:model-value="updateInlayEnabled"
      />
      <FieldCheckbox
        :model-value="autoHide"
        :label="t('tamagotchi.settings.pages.system.general.controls-island-auto-hide.title')"
        :description="t('tamagotchi.settings.pages.system.general.controls-island-auto-hide.description')"
        @update:model-value="value => autoHide = value"
      />
      <FieldCheckbox
        v-if="hideAppIcon !== undefined"
        :model-value="hideAppIcon"
        :label="t('tamagotchi.settings.pages.system.general.hide-app-icon.title')"
        :description="t('tamagotchi.settings.pages.system.general.hide-app-icon.description')"
        @update:model-value="updateHidden"
      />
    </template>
  </SettingsGeneralFields>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.system.general.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
