import type {
  Album,
  AlbumAssetsResult,
  AlbumCreate,
  AlbumUpdate,
  AlbumWithAssets,
  AssetSelection,
  ShareLink,
  ShareLinkCreate,
} from '@imogen/shared'
import { selectionBody } from './assets.ts'
import type { HttpClient } from './http.ts'

export class Albums {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Album[]> {
    const { items } = await this.http.request<{ items: Album[] }>('GET', '/api/v1/albums')
    return items
  }

  get(albumId: string): Promise<AlbumWithAssets> {
    return this.http.request<AlbumWithAssets>('GET', `/api/v1/albums/${albumId}`)
  }

  create(input: AlbumCreate): Promise<Album> {
    return this.http.request<Album>('POST', '/api/v1/albums', { body: input })
  }

  update(albumId: string, patch: AlbumUpdate): Promise<Album> {
    return this.http.request<Album>('PATCH', `/api/v1/albums/${albumId}`, { body: patch })
  }

  remove(albumId: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/albums/${albumId}`)
  }

  addAssets(albumId: string, selection: string[] | AssetSelection): Promise<AlbumAssetsResult> {
    return this.http.request<AlbumAssetsResult>('POST', `/api/v1/albums/${albumId}/assets`, {
      body: selectionBody(selection),
    })
  }

  removeAssets(
    albumId: string,
    selection: string[] | AssetSelection,
  ): Promise<{ removed: number }> {
    return this.http.request('DELETE', `/api/v1/albums/${albumId}/assets`, {
      body: selectionBody(selection),
    })
  }

  /** The live public link for this album, or null. */
  shareLink(albumId: string): Promise<ShareLink | null> {
    return this.http.request<ShareLink | null>('GET', `/api/v1/albums/${albumId}/share`)
  }

  share(albumId: string, input: ShareLinkCreate = { allowDownload: true }): Promise<ShareLink> {
    return this.http.request<ShareLink>('POST', `/api/v1/albums/${albumId}/share`, { body: input })
  }

  unshare(albumId: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/albums/${albumId}/share`)
  }
}
