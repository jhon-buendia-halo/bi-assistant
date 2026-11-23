import { Injectable, inject, signal } from '@angular/core';
import { ToastService } from '../../../core/toast/toast.service';
import { saveBlob } from '../../../shared/query-evidence/rows-csv';
import {
  Artifact,
  dashboardZipName,
  isVersionSaved,
} from '../../artifacts/models/artifact.model';
import { ArtifactsApiService } from '../../artifacts/services/artifacts-api.service';
import { ArtifactsNavState } from '../../artifacts/services/artifacts-nav-state';
import { DashboardRef } from '../../sessions/models/session.model';

/** One dashboard version, as the panel and the chat's cards show it. */
export interface ShownDashboard {
  artifactId: string;
  version: number;
  title: string;
  /** Saved to Artifacts; a draft otherwise (dashboard-panel). */
  saved: boolean;
  widgetCount: number;
  filterCount: number;
  rowCount: number | null;
}

/** What the card and the panel act on: a version of an artifact. */
export type DashboardTarget = Pick<
  DashboardRef,
  'artifactId' | 'version' | 'title'
> &
  Partial<Pick<DashboardRef, 'saved'>>;

function keyOf(target: { artifactId: string; version: number }): string {
  return `${target.artifactId}@${target.version}`;
}

/**
 * The dashboard Clara built, open in the side panel beside the chat
 * (dashboard-panel): which version is shown, whether it is saved, and the
 * actions on it — Save to Artifacts (api.md 164), Download (163) and Open
 * in Artifacts. The panel and the chat's dashboard cards share it, so a
 * save in one shows in the other.
 */
@Injectable({ providedIn: 'root' })
export class RunDashboardState {
  private readonly api = inject(ArtifactsApiService);
  private readonly nav = inject(ArtifactsNavState);
  private readonly toast = inject(ToastService);

  /** The version open in the panel; null when the panel is closed. */
  readonly shown = signal<ShownDashboard | null>(null);
  /** That version as `GET /artifacts/:id?version` answered (api.md 145). */
  readonly artifact = signal<Artifact | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** The version being saved or downloaded (`<id>@<version>`). */
  readonly saving = signal<string | null>(null);
  readonly downloading = signal<string | null>(null);
  /** The saved versions this page learned of, by artifact id. */
  private readonly savedVersions = signal<ReadonlyMap<string, number[]>>(
    new Map(),
  );
  /** The run answer's dashboard last opened by `follow`. */
  private followed: string | null = null;

  /** Whether that version is saved, as its ref or a later answer says. */
  isSaved(target: Pick<DashboardTarget, 'artifactId' | 'version' | 'saved'>) {
    return (
      target.saved === true ||
      (this.savedVersions().get(target.artifactId)?.includes(target.version) ??
        false)
    );
  }

  /** Whether that version is the one open in the panel. */
  isShown(target: { artifactId: string; version: number }): boolean {
    const shown = this.shown();
    return shown !== null && keyOf(shown) === keyOf(target);
  }

  /** Show in panel: open that version beside the chat. */
  open(ref: DashboardRef): void {
    this.shown.set({
      artifactId: ref.artifactId,
      version: ref.version,
      title: ref.title,
      saved: this.isSaved(ref),
      widgetCount: ref.widgetCount,
      filterCount: ref.filterCount,
      rowCount: ref.rowCount,
    });
    this.load(ref.artifactId, ref.version);
  }

  /**
   * A run shown in the chat ended (or was opened) with a dashboard: the
   * panel opens on that version, once per version, so a closed panel stays
   * closed until a newer version arrives.
   */
  follow(ref: DashboardRef | null | undefined): void {
    if (ref === null || ref === undefined) return;
    const key = keyOf(ref);
    if (key === this.followed) return;
    this.followed = key;
    this.open(ref);
  }

  /** Save to Artifacts: that version (the shown one by default) is published. */
  save(target: DashboardTarget | null = this.shown()): void {
    if (target === null || this.saving() !== null) return;
    const key = keyOf(target);
    this.saving.set(key);
    this.api.save(target.artifactId, target.version).subscribe({
      next: (artifact) => {
        this.saving.set(null);
        this.learn(target.artifactId, [
          ...(artifact.savedVersions ?? []),
          target.version,
        ]);
        const shown = this.shown();
        if (shown !== null && keyOf(shown) === key) {
          this.shown.set({ ...shown, saved: true });
          if (artifact.version === target.version) this.artifact.set(artifact);
        }
        this.toast.success('Saved to Artifacts');
      },
      error: (err) => {
        this.saving.set(null);
        this.toast.error(err?.error?.message ?? 'Could not save');
      },
    });
  }

  /** Download that version's zip (api.md 163): only once it is saved. */
  download(target: DashboardTarget | null = this.shown()): void {
    if (target === null || this.downloading() !== null) return;
    if (!this.isSaved(target)) return;
    this.downloading.set(keyOf(target));
    this.api.download(target.artifactId, target.version).subscribe({
      next: (blob) => {
        this.downloading.set(null);
        saveBlob(
          blob,
          dashboardZipName(target.title, target.artifactId, target.version),
        );
      },
      error: (err) => {
        this.downloading.set(null);
        this.toast.error(err?.error?.message ?? 'Could not download');
      },
    });
  }

  /** Open in Artifacts: the artifact's page at that version. */
  openInArtifacts(target: DashboardTarget | null = this.shown()): void {
    if (target === null) return;
    this.nav.openArtifact(target.artifactId, target.version);
  }

  /** Close: the panel goes; it opens again on a newer version. */
  close(): void {
    this.shown.set(null);
    this.artifact.set(null);
    this.loading.set(false);
    this.error.set(null);
  }

  /** The page that hosts the panel went away: forget what it followed. */
  reset(): void {
    this.close();
    this.followed = null;
  }

  private load(artifactId: string, version: number): void {
    this.artifact.set(null);
    this.error.set(null);
    this.loading.set(true);
    this.api.get(artifactId, version).subscribe({
      next: (artifact) => {
        const shown = this.shown();
        if (shown === null || keyOf(shown) !== keyOf({ artifactId, version }))
          return;
        this.loading.set(false);
        this.artifact.set(artifact);
        this.learn(
          artifactId,
          (artifact.versions ?? [])
            .map((v) => v.version)
            .filter((v) => isVersionSaved(artifact, v)),
        );
        const info = artifact.versions?.find((v) => v.version === version);
        this.shown.set({
          ...shown,
          title: artifact.name || shown.title,
          saved: shown.saved || isVersionSaved(artifact, version),
          widgetCount: info?.widgetCount ?? shown.widgetCount,
          filterCount: info?.filterCount ?? shown.filterCount,
          rowCount: info?.rowCount ?? shown.rowCount,
        });
      },
      error: (err) => {
        const shown = this.shown();
        if (shown === null || keyOf(shown) !== keyOf({ artifactId, version }))
          return;
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Could not load the dashboard');
      },
    });
  }

  private learn(artifactId: string, versions: number[]): void {
    const known = this.savedVersions().get(artifactId) ?? [];
    const merged = [...new Set([...known, ...versions])];
    if (merged.length === known.length) return;
    const next = new Map(this.savedVersions());
    next.set(artifactId, merged);
    this.savedVersions.set(next);
  }
}
