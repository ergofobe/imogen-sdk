import type { AlbumCreate, AlbumUpdate, AssetSelection, ShareLinkCreate } from '@imogen/shared'
import {
  Album,
  AlbumAssetsRemoved,
  AlbumAssetsResult,
  AlbumList,
  AlbumWithAssets,
  ShareLink,
  ShareLinkOrNone,
} from '@imogen/shared'
import { selectionBody } from './assets.js'
import type { HttpClient } from './http.js'

export class Albums {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Album[]> {
    const { items } = await this.http.request('GET', '/api/v1/albums', { decode: AlbumList })
    return items
  }

  get(albumId: string): Promise<AlbumWithAssets> {
    return this.http.request('GET', `/api/v1/albums/${albumId}`, { decode: AlbumWithAssets })
  }

  create(input: AlbumCreate): Promise<Album> {
    return this.http.request('POST', '/api/v1/albums', { body: input, decode: Album })
  }

  update(albumId: string, patch: AlbumUpdate): Promise<Album> {
    return this.http.request('PATCH', `/api/v1/albums/${albumId}`, {
      body: patch,
      decode: Album,
    })
  }

  remove(albumId: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/albums/${albumId}`)
  }

  addAssets(albumId: string, selection: string[] | AssetSelection): Promise<AlbumAssetsResult> {
    return this.http.request('POST', `/api/v1/albums/${albumId}/assets`, {
      body: selectionBody(selection),
      decode: AlbumAssetsResult,
    })
  }

  removeAssets(
    albumId: string,
    selection: string[] | AssetSelection,
  ): Promise<{ removed: number }> {
    return this.http.request('DELETE', `/api/v1/albums/${albumId}/assets`, {
      body: selectionBody(selection),
      decode: AlbumAssetsRemoved,
    })
  }

  /** The live public link for this album, or null. */
  shareLink(albumId: string): Promise<ShareLink | null> {
    return this.http.request('GET', `/api/v1/albums/${albumId}/share`, {
      decode: ShareLinkOrNone,
    })
  }

  share(albumId: string, input: ShareLinkCreate = { allowDownload: true }): Promise<ShareLink> {
    return this.http.request('POST', `/api/v1/albums/${albumId}/share`, {
      body: input,
      decode: ShareLink,
    })
  }

  unshare(albumId: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/albums/${albumId}/share`)
  }
}
