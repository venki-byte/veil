/**
 * Turns a user's file into plain text, entirely in the browser.
 *
 *   - Text files are read as they are.
 *   - PDF text is extracted locally with pdf.js. The PDF is never uploaded.
 *   - Photos are prepared here and transcribed by Gemini Nano on-device
 *     (see transcribeImage in src/ai/hybrid.ts). The image is never uploaded.
 */

import { planBands, rowInk, stretchContrast, toGray } from './imageBands'

export const MAX_DOCUMENT_CHARS = 80_000

/** Longest side, in pixels, of a photo handed to the on-device model. */
const MAX_IMAGE_SIDE = 1600

export type DocumentKind = 'paste' | 'text' | 'pdf' | 'photo' | 'sample'

export interface LoadedDocument {
  text: string
  name: string
  kind: DocumentKind
  /** Local object URL of the photo, for the thumbnail. Photo documents only. */
  imageUrl?: string
  /** How long on-device transcription took. Photo documents only. */
  transcriptionMs?: number
}

export function kindOfFile(file: File): 'pdf' | 'photo' | 'text' | null {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (file.type === 'image/jpeg' || file.type === 'image/png' || /\.(jpe?g|png)$/.test(name)) return 'photo'
  if (file.type.startsWith('text/') || /\.(txt|md|csv)$/.test(name)) return 'text'
  return null
}

/** Cleans up line endings, invisible characters and runs of blank lines. */
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(new RegExp('[\\u200B-\\u200D\\uFEFF\\u00AD]', 'g'), '')
    .replace(new RegExp('\\u00A0', 'g'), ' ')
    .replace(/[ \t]+\n/g, '\n')
    // Wide gaps (table columns) shrink to two spaces: the layout survives in
    // a narrow column and the cloud gets fewer tokens.
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

interface PdfTextItem {
  str: string
  hasEOL?: boolean
  transform?: number[]
  width?: number
}

/** Extracts the text layer of a PDF in the browser. */
export async function extractPdfText(file: File): Promise<string> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: string[] = []

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      let lastY: number | null = null
      let lastEndX: number | null = null

      for (const raw of content.items) {
        const item = raw as PdfTextItem
        if (typeof item.str !== 'string') continue
        const x = item.transform?.[4] ?? 0
        const y = item.transform?.[5] ?? 0

        if (lastY !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) {
          text += '\n'
        } else if (lastEndX !== null && lastY !== null && Math.abs(y - lastY) <= 2) {
          // Same line: keep table columns apart, and words separated.
          const gap = x - lastEndX
          if (gap > 12) text += '    '
          else if (gap > 1 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' '
        }

        text += item.str
        if (item.hasEOL) text += '\n'
        lastY = y
        lastEndX = x + (item.width ?? 0)
      }
      pages.push(text.trim())
    }
  } finally {
    void pdf.loadingTask.destroy()
  }

  return pages.filter(Boolean).join('\n\n')
}


function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the photo.'))), 'image/jpeg', 0.92),
  )
}

/**
 * Prepares a photo for the on-device model, in this tab:
 *   1. scales it to a size the model handles,
 *   2. converts it to grayscale and stretches the contrast, which helps dim or
 *      tinted photos,
 *   3. cuts a tall page into horizontal bands at blank rows, so each band is
 *      read with more detail than one pass over the whole page allows.
 * Returns the bands in reading order. Short or wide photos come back as one.
 */
export async function prepareImage(file: File): Promise<Blob[]> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Could not prepare the photo in this browser.')
    context.drawImage(bitmap, 0, 0, width, height)

    const pixels = context.getImageData(0, 0, width, height)
    const gray = toGray(pixels.data, width, height)
    stretchContrast(gray)
    for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) {
      pixels.data[pixel] = gray[index]
      pixels.data[pixel + 1] = gray[index]
      pixels.data[pixel + 2] = gray[index]
      pixels.data[pixel + 3] = 255
    }
    context.putImageData(pixels, 0, 0)

    const bounds = planBands(rowInk(gray, width, height), width, height)
    const bands: Blob[] = []
    for (let part = 0; part + 1 < bounds.length; part += 1) {
      const top = bounds[part]
      const bandHeight = bounds[part + 1] - top
      const slice = document.createElement('canvas')
      slice.width = width
      slice.height = bandHeight
      const sliceContext = slice.getContext('2d')
      if (!sliceContext) throw new Error('Could not prepare the photo in this browser.')
      sliceContext.drawImage(canvas, 0, top, width, bandHeight, 0, 0, width, bandHeight)
      bands.push(await canvasToBlob(slice))
    }
    return bands
  } finally {
    bitmap.close()
  }
}
