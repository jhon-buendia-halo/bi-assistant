/**
 * The pages of the `site-reviewer` eval set (agents.md 8.1, 2.16): small,
 * self-contained HTML (inline CSS, no network), each with one planted
 * defect, or none. The planted elements carry an id; the target finds them
 * by CSS selector and maps each to its mark number.
 */

const BASE_CSS =
  '*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;background:#fff}' +
  'header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid #e5e7eb}' +
  'header a{color:#1f2937;text-decoration:none;margin-left:16px}main{padding:24px}h1{margin:0 0 12px;font-size:28px}p{line-height:1.5;margin:0 0 16px}';

const HEADER =
  '<header><strong>Northwind</strong><nav><a href="#">Plans</a><a href="#">Help</a><a href="#">Sign in</a></nav></header>';

function page(title: string, css: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title}</title><style>${BASE_CSS}${css}</style></head>` +
    `<body>${HEADER}${body}</body></html>`
  );
}

/** Three calls to action in one row, in three different styles. */
export const INCONSISTENT_BUTTONS_PAGE = page(
  'Plans',
  '.row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}' +
    'button{cursor:pointer}' +
    '#cta-start{background:#2563eb;color:#fff;border:0;border-radius:4px;padding:12px 24px;font-size:16px}' +
    '#cta-demo{background:#16a34a;color:#fff;border:0;border-radius:999px;padding:6px 14px;font-size:22px;font-weight:bold}' +
    '#cta-contact{background:#fff;color:#b45309;border:3px dashed #b45309;border-radius:0;padding:18px 10px;font-size:11px;font-family:Georgia,serif}',
  '<main><h1>Choose how to begin</h1>' +
    '<p>Start a free trial, watch a short demo or talk to our team about a custom plan.</p>' +
    '<div class="row"><button id="cta-start">Start free trial</button>' +
    '<button id="cta-demo">Watch demo</button>' +
    '<button id="cta-contact">Contact sales</button></div></main>',
);

/** White text over a light, busy background. */
export const TEXT_OVER_IMAGE_PAGE = page(
  'Welcome',
  '.hero{padding:56px 24px;min-height:340px;color:#fff;' +
    'background:repeating-linear-gradient(45deg,#fef3c7 0 18px,#fde68a 18px 36px,#e0f2fe 36px 54px,#fce7f3 54px 72px)}' +
    '.hero h1{font-size:40px;max-width:640px}.hero p{font-size:18px;max-width:560px}' +
    '.hero a{display:inline-block;background:#111827;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px}',
  '<section class="hero"><h1 id="hero-heading">Make every journey simple</h1>' +
    '<p id="hero-lede">Plan, book and manage trips in one place, wherever you are going next.</p>' +
    '<a href="#" id="hero-cta">Get started</a></section>' +
    '<main><p>Trusted by travellers in more than forty countries.</p></main>',
);

/** Three cards in a row, the middle one lower and narrower. */
export const MISALIGNED_CARDS_PAGE = page(
  'Features',
  '.cards{display:flex;gap:16px;align-items:flex-start}' +
    '.card{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:16px;background:#f9fafb;min-height:160px}' +
    '.card h2{margin:0 0 8px;font-size:18px}.card p{margin:0;font-size:14px}' +
    '#card-b{margin-top:40px;flex:0 0 22%}',
  '<main><h1>What you get</h1><div class="cards">' +
    '<article class="card" id="card-a"><h2 id="card-a-title">Fast setup</h2><p>Connect your data in minutes with guided steps.</p></article>' +
    '<article class="card" id="card-b"><h2 id="card-b-title">Clear reports</h2><p>Readable charts and tables for everyone.</p></article>' +
    '<article class="card" id="card-c"><h2 id="card-c-title">Safe by default</h2><p>Access rules keep private data private.</p></article>' +
    '</div></main>',
);

/** A tidy page: one heading style, one button style, even spacing. */
export const CLEAN_PAGE = page(
  'Overview',
  '.cards{display:flex;flex-wrap:wrap;gap:16px}' +
    '.card{flex:1 1 240px;border:1px solid #d1d5db;border-radius:8px;padding:16px;background:#f9fafb}' +
    '.card h2{margin:0 0 8px;font-size:18px}.card p{margin:0 0 12px;font-size:15px}' +
    '.btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;padding:10px 18px;font-size:15px}',
  '<main><h1>Everything in one place</h1>' +
    '<p>A short overview of what the product does for your team.</p>' +
    '<div class="cards">' +
    '<article class="card"><h2>Plan</h2><p>Set goals and share them with the team.</p><a class="btn" href="#">Learn more</a></article>' +
    '<article class="card"><h2>Track</h2><p>See progress as it happens, day by day.</p><a class="btn" href="#">Learn more</a></article>' +
    '<article class="card"><h2>Report</h2><p>Send a clear summary to anyone, anytime.</p><a class="btn" href="#">Learn more</a></article>' +
    '</div></main>',
);

/** An invalid image payload: the picture never loads, with no network. */
export const BROKEN_IMAGE_PAGE = page(
  'Our team',
  '.photo{display:block;width:320px;height:200px;border:1px solid #d1d5db;margin:0 0 16px}',
  '<main><h1>Meet the team</h1>' +
    '<img id="team-photo" class="photo" src="data:image/png;base64,AAAA" alt="The team at the 2025 offsite" width="320" height="200">' +
    '<p>We are a small group of designers and engineers who care about clear products.</p></main>',
);
