// A small website with known defects, for Review a Website (agents.md 5.19):
// a page wider than a phone with a tiny button, an item template with a
// broken image and placeholder text, a cookie bar over a submit button, a
// 500 page, a sign-out link the crawl must never open, and a signed-in area
// behind /login. Usage: node site-review-site.cjs <port>
const { createServer } = require("node:http");

const port = Number(process.argv[2] || 4599);
const visits = [];

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;margin:0;padding:16px} nav a{margin-right:12px} .bar{position:fixed;left:0;right:0;bottom:0;height:140px;background:#222;color:#fff;padding:16px}</style></head>
  <body>${body}</body></html>`;

const nav = `<nav><a href="/">Home</a><a href="/items/1">Item 1</a><a href="/items/2">Item 2</a><a href="/about">About</a><a href="/account">Account</a><a href="/logout">Sign out</a><a href="/broken">Broken</a><a href="/files/terms.pdf">Terms</a></nav>`;

createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  visits.push(url.pathname);
  const signedIn = (request.headers.cookie || "").includes("session=ok");
  const send = (status, html, headers = {}) => {
    response.writeHead(status, { "content-type": "text/html", ...headers });
    response.end(html);
  };
  switch (url.pathname) {
    case "/":
      return send(
        200,
        page(
          "Home",
          `${nav}<h1>Shop</h1>
        <table style="width:900px"><tr><td>A table wider than a phone</td></tr></table>
        <button style="width:16px;height:16px;padding:0" aria-label="Close"></button>
        <input type="text" placeholder="Search">`,
        ),
      );
    case "/items/1":
    case "/items/2":
      return send(
        200,
        page(
          "Item",
          `${nav}<h1>Hi Forename</h1><img src="/missing.png" alt="Product">`,
        ),
      );
    case "/about":
      return send(
        200,
        page(
          "About",
          `${nav}<h1>About us</h1>
        <form style="position:absolute;bottom:40px;left:16px"><button type="submit">Buy now</button></form>
        <div class="bar">We use cookies</div>`,
        ),
      );
    case "/broken":
      return send(500, page("Error", "<h1>Server error</h1>"));
    case "/logout":
      return send(200, page("Signed out", "<h1>Signed out</h1>"), {
        "set-cookie": "session=; Max-Age=0; Path=/",
      });
    case "/login":
      if (request.method === "POST") {
        return send(302, "", {
          location: "/account",
          "set-cookie": "session=ok; Path=/",
        });
      }
      // `?auto=1` signs in by itself after a moment: it stands in for the
      // person typing in the sign-in window the run opens.
      return send(
        200,
        page(
          "Sign in",
          `<h1>Sign in</h1><form method="post" action="/login" id="login">
        <label>Email <input name="email" value="tester@example.com"></label>
        <label>Password <input type="password" name="password" value="secret"></label>
        <button type="submit" id="sign-in">Sign in</button></form>
        ${url.searchParams.get("auto") === "1" ? '<script>setTimeout(() => document.getElementById("login").submit(), 1500)</script>' : ""}`,
        ),
      );
    case "/account":
    case "/account/orders":
      return signedIn
        ? send(
            200,
            page(
              "Account",
              `<nav><a href="/account">Account</a><a href="/account/orders">Orders</a><a href="/logout">Sign out</a></nav><h1>Your account</h1><p>Lorem ipsum dolor sit amet.</p>`,
            ),
          )
        : send(302, "", { location: "/login" });
    case "/__visits":
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify(visits));
    default:
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`site-review fixture on http://127.0.0.1:${port}`);
});
