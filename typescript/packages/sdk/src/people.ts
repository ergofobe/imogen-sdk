import type { DetectedFace, Person, PersonUpdate } from '@imogen/shared'
import {
  DetectedFaceList,
  FaceStatus,
  PeopleMergeResult,
  PersonList,
  PersonWithPhotos,
} from '@imogen/shared'
import type { HttpClient } from './http.js'

/**
 * People, as grouped by face recognition.
 *
 * The feature is off until a server administrator enables it, so every method here can
 * legitimately return nothing — check `status()` before showing a person interface.
 */
export class People {
  constructor(private readonly http: HttpClient) {}

  status(): Promise<FaceStatus> {
    return this.http.request('GET', '/api/v1/people/status', { decode: FaceStatus })
  }

  /** Administrator only. Enabling downloads the models and scans the library. */
  setEnabled(enabled: boolean): Promise<void> {
    return this.http.request<void>('POST', '/api/v1/people/enable', { body: { enabled } })
  }

  async list(includeHidden = false): Promise<Person[]> {
    const page = await this.http.request('GET', '/api/v1/people', {
      query: { includeHidden },
      decode: PersonList,
    })
    return page.items
  }

  get(personId: string): Promise<PersonWithPhotos> {
    return this.http.request('GET', `/api/v1/people/${personId}`, { decode: PersonWithPhotos })
  }

  update(personId: string, patch: PersonUpdate): Promise<void> {
    return this.http.request<void>('PATCH', `/api/v1/people/${personId}`, { body: patch })
  }

  /** Folds several clusters into one. Use when grouping split a person in two. */
  merge(keepId: string, mergeIds: string[]): Promise<{ moved: number }> {
    return this.http.request('POST', '/api/v1/people/merge', {
      body: { keepId, mergeIds },
      decode: PeopleMergeResult,
    })
  }

  /** Moves specific faces to another person, or detaches them with null. */
  reassign(faceIds: string[], personId: string | null): Promise<void> {
    return this.http.request<void>('POST', '/api/v1/people/reassign', {
      body: { faceIds, personId },
    })
  }

  async facesIn(assetId: string): Promise<DetectedFace[]> {
    const page = await this.http.request('GET', `/api/v1/people/faces/${assetId}`, {
      decode: DetectedFaceList,
    })
    return page.items
  }

  /** A person's thumbnail, cropped from the photo their best face was found in. */
  thumbnailUrl(faceId: string): string {
    return this.http.url(`/api/v1/people/thumbnail/${faceId}`)
  }
}
