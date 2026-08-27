import type {
  Asset,
  AssetQuery,
  AssetSelection,
  AssetUpdate,
  AssetUploadMetadata,
  AssetUploadResult,
  AssetVariant,
  LibraryStats,
  ShareLink,
  ShareLinkCreate,
  TimelineBucket,
  TimelineBucketQuery,
  TimelineQuery,
  TimelineTile,
  UploadSession,
} from '@imogen/shared'
import {
  assetSelectionProblem,
  BULK_UPLOAD_CONCURRENCY,
  RESUMABLE_THRESHOLD_BYTES,
  UPLOAD_CHUNK_BYTES,
} from '@imogen/shared'
import type { HttpClient } from './http.ts'

export type AssetPage = { items: Asset[]; nextCursor: string | null; total: number | null }
export type TilePage = { items: TimelineTile[]; nextCursor: string | null; total: number | null }

/**
 * The id list is the older, shorter way of saying the same thing.
 *
 * A selection built the wrong way is refused here rather than at the server, because
 * every one of these calls is destructive or close to it, and by the time a 400 comes
 * back the request has already been sent.
 */
export function selectionBody(selection: string[] | AssetSelection): AssetSelection {
  if (Array.isArray(selection)) return { assetIds: selection }
  const problem = assetSelectionProblem(selection)
  if (problem) throw new TypeError(problem)
  return selection
}

export type UploadProgress = {
  /** Bytes transferred so far for this file. */
  loaded: number
  total: number
}

export type UploadOptions = AssetUploadMetadata & {
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

export type BulkUploadResult = {
  file: File
  result?: AssetUploadResult
  error?: Error
}

export type BulkUploadOptions = {
  concurrency?: number
  signal?: AbortSignal
  /** Called as each file settles, so a UI can update a list rather than a single bar. */
  onFileComplete?: (outcome: BulkUploadResult, completed: number, total: number) => void
  metadataFor?: (file: File) => AssetUploadMetadata
}

export class Assets {
  constructor(private readonly http: HttpClient) {}

  list(query: Partial<AssetQuery> = {}): Promise<AssetPage> {
    return this.http.request<AssetPage>('GET', '/api/v1/assets', { query })
  }

  /** Walks every page, so a caller can `for await` the whole library. */
  async *iterate(query: Partial<AssetQuery> = {}): AsyncGenerator<Asset> {
    let cursor: string | null = null
    do {
      const page: AssetPage = await this.list({ ...query, ...(cursor ? { cursor } : {}) })
      for (const asset of page.items) yield asset
      cursor = page.nextCursor
    } while (cursor)
  }

  get(assetId: string): Promise<Asset> {
    return this.http.request<Asset>('GET', `/api/v1/assets/${assetId}`)
  }

  /** The live public link for one photo, or null. */
  shareLink(assetId: string): Promise<ShareLink | null> {
    return this.http.request<ShareLink | null>('GET', `/api/v1/assets/${assetId}/share`)
  }

  /** Publishes one photo. Replaces any existing link for it. */
  share(assetId: string, input: Partial<ShareLinkCreate> = {}): Promise<ShareLink> {
    return this.http.request<ShareLink>('POST', `/api/v1/assets/${assetId}/share`, {
      body: { allowDownload: true, ...input },
    })
  }

  unshare(assetId: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/assets/${assetId}/share`)
  }

  update(assetId: string, patch: AssetUpdate): Promise<Asset> {
    return this.http.request<Asset>('PATCH', `/api/v1/assets/${assetId}`, { body: patch })
  }

  trash(selection: string[] | AssetSelection): Promise<{ count: number }> {
    return this.http.request('POST', '/api/v1/assets/trash', { body: selectionBody(selection) })
  }

  restore(selection: string[] | AssetSelection): Promise<{ count: number }> {
    return this.http.request('POST', '/api/v1/assets/restore', { body: selectionBody(selection) })
  }

  timeline(query: Partial<TimelineQuery> = {}): Promise<{ buckets: TimelineBucket[] }> {
    return this.http.request('GET', '/api/v1/assets/timeline', { query })
  }

  /**
   * Every tile in one period, in one round trip, for a grid that lays itself out.
   * `limit` defaults server-side, so only `period` is required here.
   */
  timelineBucket(
    query: Pick<TimelineBucketQuery, 'period'> & Partial<TimelineBucketQuery>,
  ): Promise<TilePage> {
    return this.http.request<TilePage>('GET', '/api/v1/assets/timeline/bucket', { query })
  }

  stats(): Promise<LibraryStats> {
    return this.http.request<LibraryStats>('GET', '/api/v1/assets/stats')
  }

  /** A URL suitable for an `<img src>`. Browsers send the session cookie themselves. */
  urlFor(assetId: string, variant: AssetVariant = 'thumbnail'): string {
    return this.http.url(`/api/v1/assets/${assetId}/${variant}`)
  }

  downloadUrl(assetId: string): string {
    return this.http.url(`/api/v1/assets/${assetId}/download`)
  }

  /** Fetches image bytes with an Authorization header, for non-browser clients. */
  async blob(assetId: string, variant: AssetVariant = 'preview'): Promise<Blob> {
    const response = await this.http.send('GET', `/api/v1/assets/${assetId}/${variant}`)
    return response.blob()
  }

  /**
   * Uploads one file, choosing the protocol by size: small files go in a single request,
   * large ones use a resumable session so a dropped connection costs one chunk rather
   * than the whole video.
   */
  async upload(file: File, options: UploadOptions = {}): Promise<AssetUploadResult> {
    if (file.size >= RESUMABLE_THRESHOLD_BYTES) {
      return this.uploadResumable(file, options)
    }

    const form = new FormData()
    // The contract lets a client name the file something other than what the File object
    // is called — an importer restoring a name an export truncated, for instance.
    form.set('file', file, options.filename ?? file.name)
    if (options.filename) form.set('filename', options.filename)
    if (options.deviceAssetId) form.set('deviceAssetId', options.deviceAssetId)
    if (options.capturedAt) form.set('capturedAt', options.capturedAt)
    if (options.favorite !== undefined) form.set('favorite', String(options.favorite))
    if (options.description) form.set('description', options.description)
    if (options.location) form.set('location', JSON.stringify(options.location))

    const result = await this.http.request<AssetUploadResult>('POST', '/api/v1/assets', {
      formData: form,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    options.onProgress?.({ loaded: file.size, total: file.size })
    return result
  }

  private async uploadResumable(file: File, options: UploadOptions): Promise<AssetUploadResult> {
    const session = await this.http.request<UploadSession>('POST', '/api/v1/uploads', {
      body: {
        filename: options.filename ?? file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        ...(options.deviceAssetId ? { deviceAssetId: options.deviceAssetId } : {}),
        ...(options.capturedAt ? { capturedAt: options.capturedAt } : {}),
        ...(options.favorite !== undefined ? { favorite: options.favorite } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(options.location ? { location: options.location } : {}),
      },
      ...(options.signal ? { signal: options.signal } : {}),
    })

    // The server already had these bytes; nothing to transfer.
    if (session.existing) {
      options.onProgress?.({ loaded: file.size, total: file.size })
      return session.existing
    }

    let offset = session.offset
    while (offset < file.size) {
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size)
      const chunk = file.slice(offset, end)

      const response = await this.http.send('PATCH', `/api/v1/uploads/${session.id}`, {
        raw: await chunk.arrayBuffer(),
        headers: { 'Upload-Offset': String(offset), 'Content-Type': 'application/octet-stream' },
        ...(options.signal ? { signal: options.signal } : {}),
      })
      const progress = (await response.json()) as { offset: number }
      offset = progress.offset
      options.onProgress?.({ loaded: offset, total: file.size })
    }

    return this.http.request<AssetUploadResult>(
      'POST',
      `/api/v1/uploads/${session.id}/complete`,
      options.signal ? { signal: options.signal } : {},
    )
  }

  /**
   * Uploads many files with bounded concurrency. Each file settles independently, so one
   * bad photo in a folder of three thousand does not abandon the rest.
   */
  async uploadMany(files: File[], options: BulkUploadOptions = {}): Promise<BulkUploadResult[]> {
    const concurrency = Math.max(1, options.concurrency ?? BULK_UPLOAD_CONCURRENCY)
    const results: BulkUploadResult[] = new Array(files.length)
    let next = 0
    let completed = 0

    const worker = async () => {
      while (next < files.length) {
        if (options.signal?.aborted) return
        const index = next++
        const file = files[index]!
        try {
          const result = await this.upload(file, {
            ...options.metadataFor?.(file),
            ...(options.signal ? { signal: options.signal } : {}),
          })
          results[index] = { file, result }
        } catch (error) {
          results[index] = { file, error: error as Error }
        }
        options.onFileComplete?.(results[index]!, ++completed, files.length)
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
    return results
  }
}
