import type {
  DocFilter,
  DocStore,
  FindOptions,
  UpdateOptions,
} from './doc-store';

/** The persisted owner field on private documents (data-model 3.15). */
export const OWNER_FIELD = 'ownerId';

/**
 * Who the current call is scoped to: the caller's user id, in both modes.
 * Throws when nobody is signed in, so a private collection is never read or
 * written without an owner.
 */
export type OwnerScope = () => string;

/**
 * A private collection seen through its owner (data-model 3.15, ADR-0011).
 *
 * Every insert stamps `ownerId`, and every find, update, unset and delete
 * ANDs `ownerId = <caller>` into its filter, so a document with another
 * owner, or none, does not exist for the caller. Upserts and patches carry
 * the caller's id, so they can neither take over nor give away a document.
 * The same in local mode (admin R33): documents stored there before it had
 * sign-in are given to Demo User by M13 at startup.
 *
 * The scope is read on every call, from the user the current code runs as.
 */
export class OwnedDocStore<T extends object> implements DocStore<T> {
  constructor(
    private readonly inner: DocStore<T>,
    private readonly scope: OwnerScope,
  ) {}

  async insert(doc: T): Promise<T> {
    return this.inner.insert(this.stamp(doc, this.scope()));
  }

  async find(filter: DocFilter = {}, options?: FindOptions): Promise<T[]> {
    return this.inner.find(this.scoped(filter), options);
  }

  async findOne(filter: DocFilter, options?: FindOptions): Promise<T | null> {
    return this.inner.findOne(this.scoped(filter), options);
  }

  async update(
    filter: DocFilter,
    patch: Partial<T>,
    options?: UpdateOptions,
  ): Promise<T | null> {
    const owner = this.scope();
    return this.inner.update(
      { ...filter, [OWNER_FIELD]: owner },
      this.stamp(patch, owner),
      options,
    );
  }

  async unset(filter: DocFilter, field: string): Promise<T | null> {
    if (field === OWNER_FIELD) {
      throw new Error(`The ${OWNER_FIELD} of a document cannot be removed`);
    }
    return this.inner.unset(this.scoped(filter), field);
  }

  async deleteOne(filter: DocFilter): Promise<number> {
    return this.inner.deleteOne(this.scoped(filter));
  }

  async deleteMany(filter: DocFilter): Promise<number> {
    return this.inner.deleteMany(this.scoped(filter));
  }

  /** `filter` AND the caller's ownership; it wins over any `ownerId` given. */
  private scoped(filter: DocFilter): DocFilter {
    return { ...filter, [OWNER_FIELD]: this.scope() };
  }

  private stamp<D extends object>(doc: D, owner: string): D {
    return { ...doc, [OWNER_FIELD]: owner };
  }
}
