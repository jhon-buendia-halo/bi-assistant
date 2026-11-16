import {
  IrisTimeoutError,
  REVIEW_WEBSITE_DEFAULT_EXCLUDE,
  withIrisTimeout,
  ReviewWebsiteInputError,
  looksSignedIn,
  preparedSessionOf,
  reviewWebsiteInputOf,
  signInQuestion,
} from './review-website.steps';
import type { ReviewWebsiteInput } from './review-website.schemas';

const INPUT: ReviewWebsiteInput = {
  url: ' https://shop.example.com/start ',
  maxPages: 50,
  maxDepth: 3,
  mobile: false,
  tablet: true,
  laptop: false,
  desktop: true,
  exclude: ' ',
  needsSignIn: true,
  loginUrl: '',
  visualReview: true,
};

describe('Review a Website pure step code (agents.md 5.19)', () => {
  it('makes the input usable: screens narrowest first, defaults, origin', () => {
    expect(preparedSessionOf(INPUT)).toEqual({
      url: 'https://shop.example.com/start',
      maxPages: 50,
      maxDepth: 3,
      screens: ['tablet', 'desktop'],
      exclude: REVIEW_WEBSITE_DEFAULT_EXCLUDE,
      needsSignIn: true,
      loginUrl: 'https://shop.example.com/start',
      origin: 'https://shop.example.com',
      visualReview: true,
    });
  });

  it('keeps the limits within their bounds', () => {
    const prepared = preparedSessionOf({
      ...INPUT,
      maxPages: 9000,
      maxDepth: -2,
    });
    expect(prepared.maxPages).toBe(250);
    expect(prepared.maxDepth).toBe(0);
  });

  it.each([
    [{ url: 'shop.example.com' }, 'Entry URL must be a web address'],
    [{ url: 'javascript:alert(1)' }, 'Entry URL must be a web address'],
    [{ loginUrl: 'not a url' }, 'Sign-in page must be a web address'],
    [{ exclude: '(' }, 'Never follow links matching is not a valid pattern'],
    [{ tablet: false, desktop: false }, 'Choose at least one screen'],
  ])('refuses %j', (patch, message) => {
    expect(() => preparedSessionOf({ ...INPUT, ...patch })).toThrow(
      ReviewWebsiteInputError,
    );
    expect(() => preparedSessionOf({ ...INPUT, ...patch })).toThrow(message);
  });

  it('reads the form values, with the defaults for what is missing', () => {
    expect(reviewWebsiteInputOf({ url: 'https://a.example' })).toEqual({
      url: 'https://a.example',
      maxPages: 50,
      maxDepth: 3,
      mobile: true,
      tablet: false,
      laptop: true,
      desktop: false,
      exclude: '',
      needsSignIn: false,
      loginUrl: '',
      visualReview: true,
    });
  });

  it('asks to sign in, and asks again in other words', () => {
    expect(signInQuestion('https://shop.example.com/').question).toMatch(
      /^Sign in to shop\.example\.com in the browser window/,
    );
    expect(signInQuestion('https://shop.example.com/', true).question).toMatch(
      /^Still not signed in to shop\.example\.com/,
    );
  });

  describe('looksSignedIn', () => {
    const base = {
      url: 'https://shop.example.com/account',
      finalUrl: 'https://shop.example.com/account',
      origin: 'https://shop.example.com',
      loginUrl: 'https://shop.example.com/login',
      hasPasswordField: false,
    };
    it('holds for the page asked for, on the site, with no password field', () => {
      expect(looksSignedIn(base)).toBe(true);
    });
    it('fails on a password field', () => {
      expect(looksSignedIn({ ...base, hasPasswordField: true })).toBe(false);
    });
    it('fails when sent off the site (an identity provider)', () => {
      expect(
        looksSignedIn({
          ...base,
          finalUrl: 'https://login.microsoftonline.com/x',
        }),
      ).toBe(false);
    });
    it('fails when sent to the sign-in page', () => {
      expect(
        looksSignedIn({
          ...base,
          finalUrl: 'https://shop.example.com/login/',
        }),
      ).toBe(false);
    });
    it('holds when the sign-in page is the entry URL itself and it shows the site', () => {
      expect(
        looksSignedIn({
          ...base,
          url: 'https://shop.example.com/',
          finalUrl: 'https://shop.example.com/',
          loginUrl: 'https://shop.example.com/',
        }),
      ).toBe(true);
    });
  });

  describe('withIrisTimeout', () => {
    it('passes the result on when the call answers in time', async () => {
      const result = await withIrisTimeout(
        '/claims/:id',
        new AbortController().signal,
        () => Promise.resolve('ok'),
        50,
      );
      expect(result).toBe('ok');
    });

    it('aborts a slow call and fails with a clear message', async () => {
      let seen: AbortSignal | undefined;
      const slow = (signal: AbortSignal) => {
        seen = signal;
        return new Promise<string>((resolve) =>
          signal.addEventListener('abort', () => resolve('stopped')),
        );
      };
      await expect(
        withIrisTimeout('/claims/:id', new AbortController().signal, slow, 20),
      ).rejects.toThrow(IrisTimeoutError);
      expect(seen?.aborted).toBe(true);
      await expect(
        withIrisTimeout('/claims/:id', new AbortController().signal, slow, 20),
      ).rejects.toThrow(
        'Iris did not answer within two minutes while reviewing /claims/:id',
      );
    });

    it('a stopped run aborts the call and is no timeout', async () => {
      const parent = new AbortController();
      const pending = withIrisTimeout(
        '/x',
        parent.signal,
        (signal) =>
          new Promise<string>((resolve) =>
            signal.addEventListener('abort', () => resolve('stopped')),
          ),
        5_000,
      );
      parent.abort();
      await expect(pending).resolves.toBe('stopped');
    });
  });
});
