<script setup lang="ts">
import StatusCapsule from './status-capsule.vue'
</script>

<template>
  <Story title="Status Capsule" group="misc">
    <Variant id="details" title="Expandable status details">
      <div :class="['flex flex-col items-start gap-8 p-4 pt-32']">
        <StatusCapsule label="Connected" details="The server channel is ready.">
          <template #indicator>
            <span :class="['i-solar:check-circle-linear size-4']" />
          </template>
        </StatusCapsule>
        <StatusCapsule label="Connection failed" details="Retry the connection in settings." tone="error" placement="below">
          <template #indicator>
            <span :class="['i-solar:danger-circle-linear size-4']" />
          </template>
        </StatusCapsule>
      </div>
    </Variant>
    <Variant id="revealed" title="Visible label">
      <div :class="['flex items-center gap-4 p-4']">
        <StatusCapsule label="Listening" reveal>
          <template #indicator>
            <span :class="['i-solar:microphone-linear size-4']" />
          </template>
        </StatusCapsule>
        <StatusCapsule label="Wake word detected" reveal tone="wake">
          <template #indicator>
            <span :class="['i-solar:microphone-3-bold size-4']" />
          </template>
        </StatusCapsule>
        <StatusCapsule label="Transcribing" reveal tone="transcribing">
          <template #indicator>
            <span :class="['i-solar:text-field-focus-bold size-4']" />
          </template>
        </StatusCapsule>
      </div>
    </Variant>
  </Story>
</template>
