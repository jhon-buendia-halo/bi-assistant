export interface InteractiveVisualBundle {
  title: string;
  description: string;
  html: string;
  css: string;
  javascript: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bodyFragment(value: string): string {
  return value
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .trim();
}

function safeStyle(value: string): string {
  return value
    .replace(/@import[^;]+;/gi, '')
    .replace(/<\/style/gi, '<\\/style');
}

function safeScript(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script');
}

/** Standalone file persisted in the workspace alongside CSS and JavaScript. */
export function storedVisualizationDocument(
  bundle: InteractiveVisualBundle,
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; img-src data: blob:; font-src data:; connect-src 'none'">
  <title>${escapeHtml(bundle.title)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
${bodyFragment(bundle.html)}
  <script src="script.js"></script>
</body>
</html>`;
}

/** Self-contained document rendered in an origin-isolated iframe. */
export function sandboxedVisualizationDocument(
  bundle: InteractiveVisualBundle,
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'">
  <title>${escapeHtml(bundle.title)}</title>
  <style>${safeStyle(bundle.css)}</style>
</head>
<body>
${bodyFragment(bundle.html)}
  <script>"use strict";\n${safeScript(bundle.javascript)}</script>
</body>
</html>`;
}
