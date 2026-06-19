import JSZip from 'jszip'

import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useExpressionStore } from '../../stores/expression-store'
import { useExpressionController } from './expression-controller'
import { readCachedExpressionFile, resolveExpressionRefs } from './expression-settings'

class TestFileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null

  readAsText(file: File): void {
    void file.text()
      .then((text) => {
        this.result = text
        this.onload?.()
      })
      .catch(error => this.onerror?.(error))
  }
}

function blobFromBytes(data: Uint8Array): Blob {
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return new Blob([buffer])
}

describe('resolveExpressionRefs', () => {
  it('reads Cubism4 expression refs from pixi-live2d settings', () => {
    const refs = resolveExpressionRefs({
      expressions: [
        { Name: 'smile', File: 'exp_smile.exp3.json' },
        { Name: 'sad', File: 'exp_sad.exp3.json' },
      ],
    })

    expect(refs).toEqual([
      { Name: 'smile', File: 'exp_smile.exp3.json' },
      { Name: 'sad', File: 'exp_sad.exp3.json' },
    ])
  })

  it('reads Cubism4 expression refs from raw model3 JSON when settings does not expose expressions', () => {
    const refs = resolveExpressionRefs({
      json: {
        Version: 3,
        FileReferences: {
          Expressions: [
            { Name: 'happy', File: 'exp_happy.exp3.json' },
          ],
        },
      },
    })

    expect(refs).toEqual([
      { Name: 'happy', File: 'exp_happy.exp3.json' },
    ])
  })

  it('falls back to ZIP-loader exp3 metadata when model3 refs are unavailable', () => {
    const refs = resolveExpressionRefs({
      _expFiles: [
        { name: 'exp_angry', fileName: 'mita/exp_angry.exp3.json', data: { Type: 'Live2D Expression' } },
      ],
    })

    expect(refs).toEqual([
      { Name: 'exp_angry', File: 'mita/exp_angry.exp3.json' },
    ])
  })
})

describe('readCachedExpressionFile', () => {
  it('reads cached exp3 data by exact file path', () => {
    const content = readCachedExpressionFile({
      _expFiles: [
        {
          name: 'exp_smile',
          fileName: 'mita/exp_smile.exp3.json',
          data: { Type: 'Live2D Expression', Parameters: [{ Id: 'ParamMouthForm', Value: 1, Blend: 'Add' }] },
        },
      ],
    }, 'mita/exp_smile.exp3.json')

    expect(content).toBe(JSON.stringify({
      Type: 'Live2D Expression',
      Parameters: [{ Id: 'ParamMouthForm', Value: 1, Blend: 'Add' }],
    }))
  })

  it('reads cached exp3 data by basename for model3 refs like Mita uses', () => {
    const content = readCachedExpressionFile({
      _expFiles: [
        {
          name: 'exp_surprised',
          fileName: 'mita/exp_surprised.exp3.json',
          data: { Type: 'Live2D Expression', Parameters: [{ Id: 'ParamEyeLOpen', Value: 1, Blend: 'Overwrite' }] },
        },
      ],
    }, 'exp_surprised.exp3.json')

    expect(content).toBe(JSON.stringify({
      Type: 'Live2D Expression',
      Parameters: [{ Id: 'ParamEyeLOpen', Value: 1, Blend: 'Overwrite' }],
    }))
  })
})

describe('mita-style ZIP expression metadata', () => {
  /**
   * @example
   * expect(refs).toHaveLength(6)
   */
  it('loads expression metadata from a nested model3 ZIP and reports no motions when none exist', async () => {
    vi.stubGlobal('window', { Live2DCubismCore: {} })
    const { ZipLoader } = await import('pixi-live2d-display/cubism4')
    await import('../../utils/live2d-zip-loader')

    const zip = new JSZip()
    const modelJson = {
      Version: 3,
      FileReferences: {
        Moc: '3.moc3',
        Textures: [
          '3.4096/texture_00.png',
          '3.4096/texture_01.png',
        ],
        Physics: '3.physics3.json',
        DisplayInfo: '3.cdi3.json',
        MotionSync: '3.motionsync3.json',
        Expressions: [
          { Name: 'default', File: 'exp_default.exp3.json' },
          { Name: 'smile', File: 'exp_smile.exp3.json' },
          { Name: 'happy', File: 'exp_happy.exp3.json' },
          { Name: 'sad', File: 'exp_sad.exp3.json' },
          { Name: 'surprised', File: 'exp_surprised.exp3.json' },
          { Name: 'angry', File: 'exp_angry.exp3.json' },
        ],
      },
    }

    zip.file('airi-mita-live2d/mita/3.model3.json', JSON.stringify(modelJson))
    zip.file('airi-mita-live2d/mita/3.moc3', new Uint8Array([0]))
    zip.file('airi-mita-live2d/mita/3.4096/texture_00.png', new Uint8Array([0]))
    zip.file('airi-mita-live2d/mita/3.4096/texture_01.png', new Uint8Array([0]))
    zip.file('airi-mita-live2d/mita/3.physics3.json', '{}')
    zip.file('airi-mita-live2d/mita/3.cdi3.json', '{}')
    zip.file('airi-mita-live2d/mita/3.motionsync3.json', '{}')
    for (const expression of modelJson.FileReferences.Expressions) {
      zip.file(`airi-mita-live2d/mita/${expression.File}`, JSON.stringify({
        Type: 'Live2D Expression',
        Parameters: [
          { Id: `Param${expression.Name}`, Value: 1, Blend: 'Add' },
        ],
      }))
    }

    const reader = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))
    const settings = await ZipLoader.createSettings(reader)
    const refs = resolveExpressionRefs(settings)
    const files = await ZipLoader.unzip(reader, settings)

    expect(refs.map(ref => ref.Name)).toEqual(['default', 'smile', 'happy', 'sad', 'surprised', 'angry'])
    expect((settings as { _cdiData?: unknown })._cdiData).toEqual({})
    expect((settings as { motions?: unknown }).motions).toBeUndefined()
    expect(files.map(file => file.webkitRelativePath).sort()).toEqual([
      'airi-mita-live2d/mita/3.4096/texture_00.png',
      'airi-mita-live2d/mita/3.4096/texture_01.png',
      'airi-mita-live2d/mita/3.moc3',
      'airi-mita-live2d/mita/3.physics3.json',
      'airi-mita-live2d/mita/exp_angry.exp3.json',
      'airi-mita-live2d/mita/exp_default.exp3.json',
      'airi-mita-live2d/mita/exp_happy.exp3.json',
      'airi-mita-live2d/mita/exp_sad.exp3.json',
      'airi-mita-live2d/mita/exp_smile.exp3.json',
      'airi-mita-live2d/mita/exp_surprised.exp3.json',
    ])
  })

  it('loads expression refs from an OPFS-restored nested Mita directory', async () => {
    vi.stubGlobal('window', { Live2DCubismCore: {} })
    vi.stubGlobal('FileReader', TestFileReader)
    const { FileLoader } = await import('pixi-live2d-display/cubism4')
    await import('../../utils/live2d-zip-loader')

    const fileWithRelativePath = (
      content: Blob | string | Uint8Array,
      name: string,
      webkitRelativePath: string,
    ): File => {
      const fileContent = content instanceof Uint8Array ? blobFromBytes(content) : content
      const file = new File([fileContent], name)
      Object.defineProperty(file, 'webkitRelativePath', {
        value: webkitRelativePath,
      })
      return file
    }
    const modelJson = {
      Version: 3,
      FileReferences: {
        Moc: '3.moc3',
        Textures: [
          '3.4096/texture_00.png',
          '3.4096/texture_01.png',
        ],
        Expressions: [
          { Name: 'default', File: 'exp_default.exp3.json' },
          { Name: 'smile', File: 'exp_smile.exp3.json' },
          { Name: 'happy', File: 'exp_happy.exp3.json' },
        ],
      },
    }
    const files = [
      fileWithRelativePath(
        JSON.stringify(modelJson),
        '3.model3.json',
        'airi-mita-live2d/mita/3.model3.json',
      ),
      fileWithRelativePath(new Uint8Array([0]), '3.moc3', 'airi-mita-live2d/mita/3.moc3'),
      fileWithRelativePath(
        new Uint8Array([0]),
        'texture_00.png',
        'airi-mita-live2d/mita/3.4096/texture_00.png',
      ),
      fileWithRelativePath(
        new Uint8Array([0]),
        'texture_01.png',
        'airi-mita-live2d/mita/3.4096/texture_01.png',
      ),
      ...modelJson.FileReferences.Expressions.map(expression =>
        fileWithRelativePath(JSON.stringify({
          Type: 'Live2D Expression',
          Parameters: [
            { Id: `Param${expression.Name}`, Value: 1, Blend: 'Add' },
          ],
        }), expression.File, `airi-mita-live2d/mita/${expression.File}`),
      ),
    ]

    const settings = await FileLoader.createSettings(files)
    const refs = resolveExpressionRefs(settings)

    expect(refs.map(ref => ref.Name)).toEqual(['default', 'smile', 'happy'])
    expect(() => settings.validateFiles(files.map(file => encodeURI(file.webkitRelativePath)))).not.toThrow()
  })

  it('registers expression groups after FileLoader upload resolves exp3 files', async () => {
    setActivePinia(createPinia())
    vi.stubGlobal('window', { Live2DCubismCore: {} })
    vi.stubGlobal('FileReader', TestFileReader)
    const { FileLoader } = await import('pixi-live2d-display/cubism4')
    await import('../../utils/live2d-zip-loader')

    const fileWithRelativePath = (
      content: Blob | string | Uint8Array,
      name: string,
      webkitRelativePath: string,
    ): File => {
      const fileContent = content instanceof Uint8Array ? blobFromBytes(content) : content
      const file = new File([fileContent], name)
      Object.defineProperty(file, 'webkitRelativePath', {
        value: webkitRelativePath,
      })
      return file
    }
    const files = [
      fileWithRelativePath(JSON.stringify({
        Version: 3,
        FileReferences: {
          Moc: '3.moc3',
          Textures: ['3.4096/texture_00.png'],
          Expressions: [
            { Name: 'happy', File: 'exp_happy.exp3.json' },
          ],
        },
      }), '3.model3.json', 'airi-mita-live2d/mita/3.model3.json'),
      fileWithRelativePath(new Uint8Array([0]), '3.moc3', 'airi-mita-live2d/mita/3.moc3'),
      fileWithRelativePath(new Uint8Array([0]), 'texture_00.png', 'airi-mita-live2d/mita/3.4096/texture_00.png'),
      fileWithRelativePath(JSON.stringify({
        Type: 'Live2D Expression',
        Parameters: [
          { Id: 'ParamMouthOpenY', Value: 0.3, Blend: 'Add' },
        ],
      }), 'exp_happy.exp3.json', 'airi-mita-live2d/mita/exp_happy.exp3.json'),
    ]

    const settings = await FileLoader.createSettings(files)
    settings.validateFiles(files.map(file => encodeURI(file.webkitRelativePath)))
    await FileLoader.upload(files, settings)
    const settingsWithObjectUrl = settings as typeof settings & { _objectURL?: string }
    settings.resolveURL = function (filePath: string) {
      if (!settingsWithObjectUrl._objectURL)
        throw new Error('FileLoader settings did not expose an object URL')

      return FileLoader.resolveURL(settingsWithObjectUrl._objectURL, filePath)
    }

    const expressionRefs = resolveExpressionRefs(settings)
    const expressionController = useExpressionController({
      internalModel: ref(undefined),
      modelId: 'mita',
    })

    await expressionController.initialise(expressionRefs, async (filePath) => {
      const response = await fetch(settings.resolveURL(filePath))
      return response.text()
    })

    const expressionStore = useExpressionStore()
    expect(expressionStore.expressionGroups.has('happy')).toBe(true)
    expect(expressionStore.expressions.has('ParamMouthOpenY')).toBe(true)
  })
})
