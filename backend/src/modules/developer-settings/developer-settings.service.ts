import { Injectable, OnModuleInit } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  DeveloperSettings,
  normalizeEndpoint,
  readDeveloperSettings,
  sameDeveloperSettings,
  startupDeveloperSettings,
  writeDeveloperSettings,
} from '../../infrastructure/developer-settings/developer-settings.file';

export interface DeveloperSettingsView {
  saved: DeveloperSettings;
  active: DeveloperSettings;
  restartRequired: boolean;
}

export interface ProbeResult {
  ok: boolean;
  message: string;
}

const PROBE_TIMEOUT_MS = 3_000;

@Injectable()
export class DeveloperSettingsService implements OnModuleInit {
  /** Captures the active setting at boot if the entry point hasn't already. */
  onModuleInit(): void {
    startupDeveloperSettings();
  }

  getView(): DeveloperSettingsView {
    const saved = readDeveloperSettings();
    const active = startupDeveloperSettings();
    return {
      saved,
      active,
      restartRequired: !sameDeveloperSettings(saved, active),
    };
  }

  /** Validates and writes the file. Throws with the user-facing message on bad input. */
  save(input: unknown): DeveloperSettingsView {
    const body = (input && typeof input === 'object' ? input : {}) as Record<
      string,
      unknown
    >;
    const phoenixEndpoint = normalizeEndpoint(body.phoenixEndpoint);
    if (!phoenixEndpoint) {
      throw new Error('Phoenix endpoint must be an http(s) URL');
    }
    const otlpEndpoint = normalizeEndpoint(body.otlpEndpoint);
    if (!otlpEndpoint) {
      throw new Error('OTLP endpoint must be an http(s) URL');
    }
    writeDeveloperSettings({
      observabilityEnabled: body.observabilityEnabled === true,
      phoenixEndpoint,
      otlpEndpoint,
    });
    return this.getView();
  }

  /**
   * Sends an empty OTLP protobuf export to `<endpoint>/v1/traces`. Uses
   * node:http rather than fetch: the global fetch is wrapped with model-call
   * retries (retry-fetch.ts), which would delay a failing probe.
   */
  testEndpoint(endpoint: unknown): Promise<ProbeResult> {
    const base = normalizeEndpoint(endpoint);
    if (!base) {
      return Promise.resolve({
        ok: false,
        message: 'Endpoint must be an http(s) URL',
      });
    }
    const url = new URL(`${base}/v1/traces`);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const started = Date.now();

    return new Promise<ProbeResult>((resolve) => {
      const req = send(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-protobuf',
            'Content-Length': '0',
          },
          timeout: PROBE_TIMEOUT_MS,
        },
        (res) => {
          res.resume();
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({
              ok: true,
              message: `Reachable — ${base} accepted an OTLP trace export in ${Date.now() - started}ms`,
            });
          } else {
            resolve({
              ok: false,
              message: `Endpoint answered ${status} — not an OTLP trace receiver`,
            });
          }
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error(`timed out after ${PROBE_TIMEOUT_MS / 1000}s`));
      });
      req.on('error', (err) => {
        resolve({ ok: false, message: `Unreachable — ${err.message}` });
      });
      req.end();
    });
  }
}
