const STATIC_PREFIX = __CDN_PREFIX__;

const TS_URL = /[\d]+id_\/(http:.*)/;

const cfOpts = {
  scrapeShield: false,
  cacheTtlByStatus: { "200-299": 3600, 404: 1, "500-599": 0 }
}


// ===========================================================================
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

// ===========================================================================
function notFound(err = "not found") {
  return new Response(JSON.stringify({"error": err}), {status: 404, headers: {"Content-Type": "application/json"}});
}

// ===========================================================================
async function handleRequest(request) {
  const requestURL = new URL(request.url);
  const requestPath = requestURL.pathname;

  //console.log(requestPath);

  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  if (requestPath.startsWith("/echo/")) {
    const data = {"echo": {
        "method": request.method,
        "url": request.url,
        "headers": Object.fromEntries(request.headers.entries())
    }};

    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' }});
  }

  if (requestPath.startsWith("/proxy/")) {
    return handleLiveWebProxy(request);
  }

  if (requestPath.startsWith("/dist/") || requestPath.startsWith("/assets/")) {
    return handleFetchCDN(STATIC_PREFIX + requestPath);
  }

  if (requestPath === "/" || requestPath === "/index.html") {
    return handleIndex();
  }
}

// ===========================================================================
async function handleFetchCDN(url) {
  const resp = await fetch(url, {cf: cfOpts});
  const headers = new Headers(resp.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  if (url.endsWith(".js")) {
    headers.set("Content-Type", "application/javascript");
  }
  return new Response(resp.body, {headers});
}

// ===========================================================================
function handleIndex() {
  const text = `
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="assets/spectre.min.css">
    <link rel="stylesheet" href="assets/spectre-exp.min.css">
    <link rel="stylesheet" href="assets/spectre-icons.min.css">
    <link rel="stylesheet" href="assets/styles.css">
    <script src="dist/jsnet-client.js"></script>
    <script src="dist/main.js"></script>
  </head>
  <body>
    <oldweb-today></oldweb-today>
  </body>
</html>
  `;

  return new Response(text, {headers: {
    "Content-Type": "text/html",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp"
  }});
}

// ===========================================================================
async function handleLiveWebProxy(request) {
  const requestPath = request.url.split(request.headers.get("host"), 2)[1];

  let proxyUrl = requestPath.slice("/proxy/".length);

  if (proxyUrl.startsWith("//")) {
    proxyUrl = "https:" + proxyUrl;
  }

  const proxyHeaders = new Headers();
  for (const [name, value] of request.headers) {
    if (name.startsWith("cf-") || name.startsWith("x-pywb-") || 
      name === "x-proxy-referer") {
      continue;
    }
    proxyHeaders.set(name, value);
  }

  //proxyHeaders.delete("x-forwarded-proto");
  const referrer = request.headers.get("x-proxy-referer");
  if (referrer) {
    proxyHeaders.set("Referer", request.headers.get("x-proxy-referer"));
    const origin = new URL(referrer).origin;
    if (origin !== new URL(proxyUrl).origin) {
      proxyHeaders.set("Origin", origin);
      proxyHeaders.set("Sec-Fetch-Site", "cross-origin");
    } else {
      proxyHeaders.delete("Origin");
      proxyHeaders.set("Sec-Fetch-Site", "same-origin");
    }
  }

  const body = request.method === "GET" || request.method === "HEAD" ? null : request.body;

  const resp = await fetchWithRedirCheck(proxyUrl, request.method, proxyHeaders, body);

  const headers = new Headers(resp.headers);
  headers.set("Access-Control-Allow-Origin", request.headers.get("Origin"));
  headers.set("Access-Control-Allow-Credentials", "true");

  const set_cookie = resp.headers.get("set-cookie");
  if (set_cookie) {
    headers.set("X-Proxy-Set-Cookie", set_cookie);
  }
 
  let status;
  const statusText = resp.statusText;

  if ([301, 302, 303, 307, 308].includes(resp.status)) {
    headers.set("x-redirect-status", resp.status);
    headers.set("x-redirect-statusText", resp.statusText);
    if (resp.location) {
      headers.set("x-orig-location", resp.location);
    }
    status = 200;
  } else {
    status = resp.status;
  }

  const allowHeaders = ["x-redirect-status", "x-redirect-statusText", "X-Proxy-Set-Cookie", "x-orig-location"];

  for (const header of resp.headers.keys()) {
    if (["transfer-encoding", "content-encoding"].includes(header)) {
      continue;
    }

    allowHeaders.push(header);
  }

  headers.set("Access-Control-Expose-Headers", allowHeaders.join(","));

  return new Response(resp.body, {headers, status, statusText});
}

// ===========================================================================
function handleOptions(request) {
  // Make sure the necesssary headers are present
  // for this to be a valid pre-flight request
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    // Handle CORS pre-flight request.
    // If you want to check the requested method + headers
    // you can do that here.
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Method": request.headers.get('Access-Control-Request-Method'),
        "Access-Control-Allow-Headers": request.headers.get('Access-Control-Request-Headers'),
        "Access-Control-Allow-Origin": request.headers.get("Origin"),
        "Access-Control-Allow-Credentials": "true"
      }
    });
  } else {
    // Handle standard OPTIONS request.
    // If you want to allow other HTTP Methods, you can do that here.
    return new Response(null, {
      headers: {
        Allow: 'GET, HEAD, POST, OPTIONS',
      },
    })
  }
}

// ===========================================================================
async function fetchWithRedirCheck(url, method, headers, body) {
  let resp = null;

  while (true) {
    resp = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      cf: cfOpts
    });

    if (resp.status > 300 && resp.status < 400) {
      const location = resp.headers.get("location");

      const m = location.match(TS_URL);
      const m2 = url.match(TS_URL);
      if (m && m2) {
        if (m[1] === m2[1]) {
          url = location;
          continue;
        }
      }

      if (m) {
        resp.location = m[1];
      }

      if (location.startsWith("https://")) {
        url = location;
        continue;
      }
    }

    break;
  }

  return resp;
}
