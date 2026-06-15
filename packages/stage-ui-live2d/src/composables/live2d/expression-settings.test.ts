import JSZip from 'jszip'

import { describe, expect, it, vi } from 'vitest'

import { readCachedExpressionFile, resolveExpressionRefs } from './expression-settings'

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
})
