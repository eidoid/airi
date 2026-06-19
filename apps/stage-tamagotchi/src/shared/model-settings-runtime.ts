import type { ExpressionEntry, ExpressionGroupDefinition, ExpressionLlmMode } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components'

export const modelSettingsRuntimeSnapshotChannelName = 'airi-model-settings-runtime-snapshot'

/**
 * Live2D expression metadata mirrored from the stage window to settings windows.
 *
 * The settings window does not render the Live2D model itself, so it cannot
 * populate its local expression store from model load callbacks. This snapshot
 * carries only cloneable metadata and intentionally excludes runtime timers.
 */
export interface Live2DExpressionRuntimeSnapshot {
  /** Stage runtime owner that produced this expression snapshot. */
  ownerInstanceId: string
  /** Model id used by the expression store for persisted defaults. */
  modelId: string
  /** Named expression groups parsed from model3.json and exp3.json files. */
  groups: ExpressionGroupDefinition[]
  /** Direct parameter entries without non-cloneable reset timer handles. */
  entries: Array<Omit<ExpressionEntry, 'resetTimer'>>
  /** Expression groups currently active on the main stage runtime. */
  activeGroups: string[]
  /** Expression exposure mode used by the main stage LLM tool registry. */
  llmMode: ExpressionLlmMode
  /** Per-expression exposure flags used when {@link llmMode} is `custom`. */
  llmExposed: Array<{ name: string, exposed: boolean }>
  /** Timestamp used to order freshly broadcast runtime snapshots. */
  updatedAt: number
}

export type ModelSettingsRuntimeChannelEvent
  = | { type: 'request-current' }
    | { type: 'snapshot', snapshot: ModelSettingsRuntimeSnapshot, live2dExpressions?: Live2DExpressionRuntimeSnapshot }
    | {
      type: 'live2d-expression-llm-settings'
      ownerInstanceId: string
      llmMode: ExpressionLlmMode
      llmExposed: Array<{ name: string, exposed: boolean }>
    }
    | {
      type: 'live2d-expression-preview'
      ownerInstanceId: string
      /** Expression group to activate. Null means clear previewed expression state. */
      name: string | null
    }
    | { type: 'owner-gone', ownerInstanceId: string }
