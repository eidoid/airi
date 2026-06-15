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

      <div v-auto-animate :class="['flex', 'flex-col', 'gap-2']">
        <div
          v-for="(item, index) in items"
          :key="index"
          :class="['w-full', 'flex', 'items-center', 'gap-2']"
        >
          <Input
            :model-value="item"
            :placeholder="props.valuePlaceholder"
            :class="['w-90%']"
            @update:model-value="updateItem(index, $event as string | undefined)"
          />
          <button
            type="button"
            i-solar:minus-circle-line-duotone
            size="6"
            :class="['min-w-20px', 'w-10%', 'flex', 'text-red-500']"
            @click="removeItem(index)"
          />
        </div>

        <button
          type="button"
          :aria-label="props.label"
          :class="[
            'mt-2 flex h-9 w-full items-center justify-center rounded-lg',
            'border border-dashed border-blue-300 text-blue-500',
            'transition-all duration-200 ease-in-out',
            'hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30',
          ]"
          @click="addItem"
        >
          <div i-solar:add-circle-line-duotone size="6" />
        </button>
      </div>
    </label>
  </div>
</template>
