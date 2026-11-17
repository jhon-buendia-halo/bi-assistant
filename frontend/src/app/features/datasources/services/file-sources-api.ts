import { InjectionToken } from '@angular/core';
import {
  FileDatasourceConfig,
  SheetPreview,
  SourceFile,
} from '../models/datasource.model';
import { MockFileSourcesApi } from './mock-file-sources-api';

export interface SheetPreviewRequest {
  uploadId?: string;
  datasourceId?: string;
  fileId: string;
  sheet: string;
  headerRow?: number;
  range?: string;
  excludeLastRow?: boolean;
  allText?: boolean;
}

/** Upload, preview and import of Excel / CSV files (plan M1-31, endpoints 156 to 158 and 16). */
export interface FileSourcesApi {
  upload(file: File): Promise<{ uploadId: string; file: SourceFile }>;
  preview(req: SheetPreviewRequest): Promise<SheetPreview>;
  discard(uploadId: string): Promise<void>;
  importAndCheck(
    config: FileDatasourceConfig,
  ): Promise<{ ok: boolean; message: string }>;
}

/** The mock answers until the HTTP implementation (endpoints 156 to 158) replaces it. */
export const FILE_SOURCES_API = new InjectionToken<FileSourcesApi>(
  'FILE_SOURCES_API',
  { providedIn: 'root', factory: () => new MockFileSourcesApi() },
);
