# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.0.4.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

The Playwright suite launches the real Electron shell and its child NestJS
backend in an isolated user-data directory. It also starts the seeded World Cup
PostgreSQL service from the repository's `docker-compose.yml`.

```bash
npm run test:e2e
```

Docker must be running. If an equivalent World Cup database is already
available at `127.0.0.1:55432`, skip Compose startup with:

```bash
E2E_SKIP_DOCKER=1 npm run test:e2e
```

Port 3000 must be free because every test launches its own backend. The suite
runs with one worker to keep that port exclusive and attaches Electron output,
diagnostic logs, screenshots, videos, and traces when a test fails.

Use `npm run test:e2e:ui` for Playwright's interactive runner. When an intended
UI change affects the checked-in visual baseline, update it with
`npm run test:e2e:update` and review the resulting PNG before keeping it.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
