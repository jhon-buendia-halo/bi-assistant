import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'intellify:public';

/** Marks a route that needs no `X-API-Key` (`/health`, `/openapi.json`). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
