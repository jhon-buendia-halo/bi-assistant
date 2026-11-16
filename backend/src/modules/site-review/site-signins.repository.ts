import { Inject, Injectable } from '@nestjs/common';
import { SITE_SIGNINS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';

/**
 * A website sign-in saved by Review a Website (data-model 3.19): the
 * browser's storage state (cookies and local storage) for one origin,
 * encrypted with `CryptoService`. Never logged, never sent by the API.
 */
export interface SiteSignInDoc {
  /** The site's origin: scheme, host and port. */
  origin: string;
  /** The Playwright storage state as JSON, encrypted (data-model 2.3). */
  storageStateCiphertext: string;
  capturedAt: string;
}

/** The saved sign-ins, one per origin. */
@Injectable()
export class SiteSignInsRepository {
  constructor(
    @Inject(SITE_SIGNINS_STORE)
    private readonly store: DocStore<SiteSignInDoc>,
  ) {}

  get(origin: string): Promise<SiteSignInDoc | null> {
    return this.store.findOne({ origin });
  }

  /** Save the origin's sign-in, replacing the one it had. */
  async put(doc: SiteSignInDoc): Promise<void> {
    const existing = await this.store.findOne({ origin: doc.origin });
    if (existing) {
      await this.store.update({ origin: doc.origin }, doc);
    } else {
      await this.store.insert(doc);
    }
  }

  delete(origin: string): Promise<number> {
    return this.store.deleteOne({ origin });
  }
}
