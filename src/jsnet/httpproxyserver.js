
const encoder = new TextEncoder();

const CORS_PREFIX  = __CORS_PREFIX__;
const ARCHIVE_PREFIX = __ARCHIVE_PREFIX__;


export default class HttpProxyServer
{
  constructor({socket, replayUrl, replayTs, homePage, proxyIP, proxyPort, updateCallback}) {
    this.socket = socket;
    this.replayTs = replayTs;
    this.replayUrl = replayUrl;
    this.homePage = homePage;
    this.proxyIP = proxyIP;
    this.proxyPort = proxyPort;
    this.updateCallback = updateCallback;

    this.keepAlive = false;
  }

  get proxyPac() {
    return `\
function FindProxyForURL(url, host)
{
    if (isInNet(host, "${this.proxyIP}") || shExpMatch(url, "http://${this.proxyIP}:${this.proxyPort}/*")) {
        return "DIRECT";
    }

    return "PROXY ${this.proxyIP}:${this.proxyPort}";
}
`;
  }

  useKeepAlive(req) {
    //disabled for now
    return false;

    if (!req.match(/Proxy-Connection\:\skeep-alive/i)) {
      return false;
    }

    // only use for IE5 or IE6 for now..
    if (!req.match(/User-Agent\:.*MSIE (5|6)/)) {
      return false;
    }

    return true;
  }

  async handleResponse() {
    const writer = this.socket.writable.getWriter();
    const reader = this.socket.readable.getReader();

    await this.handleOneResponse(writer, reader);

    while (this.keepAlive) {
      await this.handleOneResponse(writer, reader);
    }

    try {
      writer.close();
    } catch (e) {
      console.log(e);
    }
  }

  async handleOneResponse(writer, reader) {
    let req = null;

    try {
      const data = await reader.read();
      if (data.done || !data.value) {
        this.keepAlive = false;
        return;
      }
      req = new TextDecoder().decode(data.value);
    } catch (e) {
      console.log(e);
      this.sendResponse({
        content: "Server Error",
        status: 500,
        statusText: "Server Error",
        writer
      });
      return;
    }

    if (this.updateCallback) {
      this.updateCallback();
    }

    //TODO: handle other methods
    const m = req.match(/GET\s([^\s]+)/);

    //console.log(req);

    let requestURL = m && m[1];

    if (requestURL === "/proxy.pac") {
      this.sendResponse({
        content: this.proxyPac,
        contentType: "application/x-ns-proxy-autoconfig",
        writer
      });
      return;
    }

    this.keepAlive = this.useKeepAlive(req);

    if (requestURL === "/" || requestURL === this.homePage) {
      this.sendRedirect({
        redirect: this.replayUrl,
        writer
      });
      return;
    }

    if (!requestURL || !requestURL.startsWith("http://")) {
      this.sendResponse({
        content: "Invalid URL: " + requestURL,
        status: 400,
        statusText: "Bad Request",
        writer
      });
      return;
    }
  
    const targetUrl = m[1];

    const resp = await this.doProxy(targetUrl);

    if (resp.status !== 200 && !resp.headers.get("memento-datetime")) {
      let msg = "";
      let status = 400;

      switch (resp.status) {
        case 429:
          msg = "Too Many Requests. Please try again later";
          break;

        case 404:
          msg = "Page Not Found";
          status = resp.status;
          break;
      }

      this.sendResponse({
        content: `Sorry, an error has occured.\n(Status ${resp.status}) ${msg}`,
        status,
        statusText: "Bad Request",
        writer
      });
      return;
    }

    const content = await resp.arrayBuffer();
    
    let { status, statusText } = resp;

    if (resp.headers.has("x-redirect-status")) {
      status = resp.headers.get("x-redirect-status");
      statusText = resp.headers.get("x-redirect-statusText") || "Redirect";

      const redirect = resp.headers.get("x-orig-location") || resp.headers.get("location");

      if (redirect) {
        this.sendRedirect({redirect, writer});
        return;
      }
    }

    const contentType = resp.headers.get("content-type");

    this.sendResponse({content, status, statusText, contentType, writer});
  }
  
  sendResponse({writer, content, status = 200, statusText = "OK", contentType = "text/plain"}) {
    const payload = typeof(content) === "string" ? encoder.encode(content) : new Uint8Array(content);

    const contentTypeStr = (status === 200 && contentType) ? `Content-Type: ${contentType}\r\n` : "";

    try{
      writer.write(encoder.encode(`\
HTTP/1.0 ${status} ${statusText}\r\n\
${contentTypeStr}\
Connection: ${this.keepAlive ? 'keep-alive' : 'close'}\r\n\
Proxy-Connection: ${this.keepAlive ? 'keep-alive' : 'close'}\r\n\
Content-Length: ${payload.byteLength}\r\n\
\r\n`));
      
      writer.write(payload);

    } catch (e) {
      console.log(e);
    }

    //this.socket.close();
  }

  sendRedirect({writer, redirect}) {

    try {
      writer.write(encoder.encode(`\
HTTP/1.0 301 Permanent Redirect\r\n\
Content-Type: text/plain\r\n\
Connection: ${this.keepAlive ? 'keep-alive' : 'close'}\r\n\
Proxy-Connection: ${this.keepAlive ? 'keep-alive' : 'close'}\r\n\
Content-Length: 0\r\n\
Location: ${redirect}\r\n\
\r\n`));

    } catch (e) {
      console.log(e);
    }

    //this.socket.close();
  }

  doProxy(targetUrl) {
    //TODO: multi archive support
    const fetchUrl = CORS_PREFIX + (this.replayTs ? ARCHIVE_PREFIX + this.replayTs + "id_/" + targetUrl : targetUrl);

    return fetch(fetchUrl, {headers: {"X-OWT-No-HTTPS": "1"}});
  }
}
