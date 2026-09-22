// The shipped version, read from package.json at build time — electron-builder
// reads the same field, so the number shown in the app always matches the
// installer and the `vX.Y.Z` tag the release workflow produced.
import { version } from '../../../../package.json';

export const APP_VERSION: string = version;
