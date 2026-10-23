/**
 * Registers the local World Cup test REST API as a `rest` datasource plus a
 * dataset in a running backend: `npm run worldcup:rest:setup`, kept for the
 * existing docs and habits. It is `setup-fixture-rest.ts` with its defaults
 * (the API on http://127.0.0.1:55080, `WORLD_CUP_API_URL` still honoured) and
 * takes the same flags; since BA-187 it signs in by itself in local mode.
 */
import { runCli } from './setup-fixture-rest';

runCli();
