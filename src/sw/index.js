import { SWReplay } from "@webrecorder/wabac/src/swmain";


class COEPSWReplay extends SWReplay
{
  async defaultFetch(request) {
    const resp = await super.defaultFetch(request);

    const headers = new Headers(resp.headers);
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");

    let body = resp.body;

    if (request.url.endsWith(".gz")) {
      if (self.DecompressionStream) {
        const ds = new DecompressionStream("gzip");
        body = body.pipeThrough(ds);
      } else {
        
      }
      headers.set("Content-Encoding", "gzip");
    }

    return new Response(body, {
      status: resp.status,
      statusText: resp.statusText,
      headers
    });
  }
}


if (self.registration) {
  const defaultConfig = {
    injectScripts: ["assets/ruffle/ruffle.js"],
  };

  self.sw = new COEPSWReplay({defaultConfig});
  console.log("owt sw");
} else {
  console.log("not in sw");
}


