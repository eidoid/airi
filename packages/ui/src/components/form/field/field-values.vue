<script setup lang="ts">
import { Input } from '../input'

const props = defineProps<{
  label?: string
  description?: string
  name?: string
  valuePlaceholder?: string
  required?: boolean
  inputClass?: string
}>()

const emit = defineEmits<{
  (e: 'remove', index: number): void
  (e: 'add'): void
}>()

const items = defineModel<string[]>({ required: true })

function addItem() {
  // Replace the array instead of mutating it in place: parents that pass a
  // plain array through `v-model` do not observe `push`/`splice`.
  items.value = [...items.value, '']
  emit('add')
}

function removeItem(index: number) {
  items.value = items.value.filter((_, itemIndex) => itemIndex !== index)
  emit('remove', index)
}

function updateItem(index: number, value: string | undefined) {
  items.value = items.value.map((item, itemIndex) => itemIndex === index ? value ?? '' : item)
}
</script>

<template>
  <div :class="['max-w-full']">
    <label :class="['flex', 'flex-col', 'gap-2']">
      <div>
        <div :class="['flex', 'items-center', 'gap-1', 'text-sm', 'font-medium']">
          <slot name="label">
            {{ props.label }}
          </slot>
          <span v-if="props.required !== false" :class="['text-red-500']">*</span>
        </div>
        <div :class="['text-nowrap', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          <slot name="description">
            {{ props.description }}
          </slot>
        </div>
      </div>

      <div v-auto-animate :class="['flex flex-col gap-2']">
        <div
          v-for="(item, index) in items"
          :key="index"
          :class="['flex w-full items-center gap-2']"
        >
          <Input
            :model-value="item"
            :placeholder="props.valuePlaceholder"
            :class="['flex-1']"
            @update:model-value="updateItem(index, $event as string | undefined)"
          />
          <button
            type="button"
            :class="[
              'shrink-0',
              'text-neutral-400 hover:text-red-500',
              'transition-colors',
            ]"
            @click="removeItem(index)"
          >
            <div :class="['i-solar:minus-circle-line-duotone size-5']" />
          </button>
        </div>

        <button
          type="button"
          :class="[
            'flex w-full items-center justify-center gap-2',
            'rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700',
            'py-2 text-xs text-neutral-500 dark:text-neutral-400',
            'transition-colors',
            'hover:border-primary-400 hover:text-primary-500',
            'dark:hover:border-primary-600 dark:hover:text-primary-400',
          ]"
          @click="addItem"
        >
          <div :class="['i-solar:add-circle-line-duotone size-4']" />
        </button>
      </div>
    </label>
  </div>
</template>
