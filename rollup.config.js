import { nodeResolve } from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';
import serve from 'rollup-plugin-serve';
//import livereload from 'rollup-plugin-livereload';
import replace from '@rollup/plugin-replace';

// the index.html to serve from cloudflare
const INDEX_HTML = require("fs").readFileSync("./site/index.html", {encoding: "utf-8"});

// base path for <path>/assets and <path>/dist when running from cloudflare worker
const CDN_PREFIX = "https://dh-preserve.sfo2.digitaloceanspaces.com/owt";

// base path for images (used in config.json)
const IMAGE_PREFIX = CDN_PREFIX + "/images";

// fallback CORS proxy for running as static site
// const CORS_PREFIX = "http://cors-anywhere.herokuapp.com/";

// path to CORS proxy
const CORS_PREFIX = "/proxy/";


// path to web archive / wayback machine
// TODO: support multiple archives
const ARCHIVE_PREFIX = "https://web.archive.org/web/";

export default [{
    input: 'src/jsnet/jsnet.js',
    output: [
      {
        file: 'site/dist/jsnet.js',
        format: 'iife',
      },
    ],
    treeshake: false,
    plugins: [
      nodeResolve(),
      copy({
        targets: [
          { src: 'src/jsnet/picotcp.*', dest: 'site/dist/' },
        ]
      }),
      replace({
        __CORS_PREFIX__: JSON.stringify(CORS_PREFIX),
        __ARCHIVE_PREFIX__: JSON.stringify(ARCHIVE_PREFIX)
      })
    ]
  },
  {
    input: 'src/jsnet/jsnet-client.js',
    output: [
      {
        file: 'site/dist/jsnet-client.js',
        format: 'iife',
        name: 'JSNetClient'
      }
    ],
    plugins: [nodeResolve()]
  },
  {
    input: 'src/main.js',
    output: [
      {
        file: 'site/dist/main.js',
        format: 'iife',
      }
    ],
    plugins: [
      nodeResolve(),
      copy({
        targets: [
          { src: 'src/bas/BasiliskII.*', dest: 'site/dist/' },
          { src: 'src/bas/bas-worker.js', dest: 'site/dist/' },
          { src: 'src/v86/libv86.js', dest: 'site/dist/' },
          { src: 'src/config.json', dest: 'site/assets/',
            transform: (contents) => contents.toString().replace(/\$IMGPATH/g, IMAGE_PREFIX)
          }
        ]
      }),
      process.env.SERVE === "1" && 
      serve({
        contentBase: './site/',
        headers: {
         'Cross-Origin-Opener-Policy': 'same-origin',
         'Cross-Origin-Embedder-Policy': 'require-corp'
        },
        onListening: onServe,
      }),
      //doesn't work with the cross-origin headers...
      //process.env.SERVE === "1" && 
      //livereload({
      //  watch: "src/",
      //  verbose: true
      //})
    ]
  },
  {
    input: 'src/worker/index.js',
    output: [{
      file: 'worker-site/index.js',
      format: 'iife',
      name: 'owt',
    },
    {
      file: 'worker-site/localServer.js',
      format: 'cjs',
    }],
    plugins: [
      replace({
        __CDN_PREFIX__: JSON.stringify(CDN_PREFIX),
        __INDEX_HTML__: JSON.stringify(INDEX_HTML)
      })
    ]
  },
]




function onServe(server) {
  const listeners = server.listeners("request");
  server.removeAllListeners("request");

  const { handleLiveWebProxy } = require("./worker-site/localServer");
  const fetch = require("node-fetch");
  global.Response = fetch.Response;
  global.Headers = fetch.Headers;
  global.Request = fetch.Request;
  global.fetch = fetch;

  server.on("request", async (request, response) => {
    if (request.url.startsWith("/proxy/")) {
      const url = request.url.slice("/proxy/".length);
      const req = new Request(`http://localhost:10001/${url}`, {method: "GET"});
      const resp = await handleLiveWebProxy(url, req);
      response.writeHead(resp.status, Object.fromEntries(resp.headers.entries()));
      const data = new Uint8Array(await resp.arrayBuffer());
      response.end(data);
      return;
    }

    return listeners[0](request, response);
  });

  console.log("Running Dev Server with Live Web Proxy");
}
