# JS OldWeb.today -- JavaScript Browser Emulation

[oldweb.today](https://oldweb.today) (OWT) is a system that connects emulated web browsers to web archives, allowing users to browse the old web, today, as it was!

## Supported Browsers

See the [oldweb.today](https://oldweb.today) for the latest list of browsers. The goal is to support common (Netscape, IE, etc..) as well as other lesser known, but notable browsers in the history of the web.

If you would like to see a browser supported, or would like to contribute a browser, please open an issue!

### Flash and Java

Netscape and IE have early versions of Java and Shockwave or Flash installed.

Java (1.0) should work in Netscape 3, and Java 1.1 should work in Netscape 4 (Windows) and IE 5 and IE 6.

Netscape and IE also should have the latest supported version of Flash installed. For Mac browsers, this usually means Shockwave 4.

The IE 6 browser has Flash 9, the latest version of Flash that runs on Win98 installed.


## How it Works

This current version runs entirely in JavaScript, using emulators to run Windows, MacOS and a full network stack. *Everything* runs in your browser, and OldWeb.today can be hosted as a static site. A remote CORS proxy is used due to CORS restrictions for accessing external archives.

The version of OldWeb.today works by building on and combining a number of great tools created by others, including:

- [V86 Emulator](https://github.com/copy/v86), a JavaScript x86 emulator by [Fabian](https://github.com/copy) is used to run Windows
- [Basilisk II JS Port](https://github.com/jsdf/macemu), a JavaScript port of the Basilisk II emulator by [James Friend](https://jamesfriend.com.au/) is to run MacOS

Each of these emulators were modified ([here](https://github.com/oldweb-today/macemu) and [here](https://github.com/oldweb-today/v86)) to support a custom JavaScript network stack using picotcp created by [Emulation as a Service](https://gitlab.com/emulation-as-a-service) developers Rafael Gieshke and Klaus Rechert:

- [picotcp.js](https://gitlab.com/emulation-as-a-service/picotcp.js) - A WebAssembly build of [picotcp](https://github.com/tass-belgium/picotcp)
- [webnetwork.js](https://gitlab.com/emulation-as-a-service/eaas-proxy/-/blob/master/webnetwork.js) - application of picotcp.js to run a web server in JavaScript.

This system was further modified and integrated into OldWeb.today to connect to terminate HTTP connections from emulated browsers and respond with HTTP data from a regular `fetch()` request, either to live web or an archive source. Currently, only GET requests are supported and only standard Content-Length and Content-Type headers are proxied back.

Each browser is configured to connect via an HTTP proxy to the special IP `http://10.0.2.2/` which the JS http server redirects to the actual home page.
In this way, the emulator image has a fixed home page that resolves to the actual page.
Similarily, the timestamp set on the page is used by the JS proxy server to load the specified date from the archive.

This allows changing the datetime and the home page URL without restarting the emulator, simply by reloading the home page in the emulated browser.

The network stack (compiled to WASM) is running in a separate web worker. The Basilisk emulator is compiled with Emscripten and also runs in a separate worker.
A SharedArrayBuffer is needed to communicate between them. The v86 emulator runs in the main thread and communicates via the network worker via BroadcastChannel messaging.


## Deployment

OldWeb.today requires Node and a package manager npm/yarn to build and modify.

To run locally, first install with `yarn install`


### Local Deployment (Local Live Web Proxy)

The recommended deployment option for development is to run a dev server with a local CORS proxy.
This can be done simply by running the rollup dev server with:


```shell

yarn run start-dev
```

This will start a local web server (via rollup) and you should be able to access OldWeb.today via
`http://localhost:10001/`. The local proxy will be running at `http://localhost:10001/proxy/`

### Production Deployment -- Cloudflare

For production, the recommended deployment is to run using [Cloudflare Workers](https://workers.cloudflare.com/), which handles
the live web proxy. The free service should be sufficient for most use cases.

To use this option:

1. In `worker-site`, copy `wrangler.toml.sample` to `wrangler.toml`.
2. Set your `account_id` and `name` as per [configuration instructions](https://developers.cloudflare.com/workers/learning/getting-started#6-preview-your-project).
3. Run `yarn run publish` to publish to your Cloudflare Worker endpoint.
4. Load OldWeb.Today from your Cloudflare URL!

### Production Deployment -- Static Site with Local Archive

An even simpler deployment, OldWeb.today can be deployed fully as a static site, by serving the content in the `./site` directory
over an HTTP server.

However, this option will not include a CORS proxy, which is needed for loading from live web or a remote archive.

One option is to run with the publicly available [CORS Anywhere](https://cors-anywhere.herokuapp.com/) proxy for connecting to live web and remote archives.

As this proxy is rate limited, this option is not recommended for production deployment.

This deployment makes sense if also running a local web archive on the same host (and live web access is not needed), removing the need for a CORS proxy.

To use this method:

1. In `rollup.config.js`, modify the `CORS_PREFIX` and/or the `ARCHIVE_PREFIX` to point to a local archive, for example (see below for more details):

  ```js
  const CORS_PREFIX = "";
  
  const ARCHIVE_PREFIX = "/wayback/";
  ```

2. Run `yarn run build`

3. OldWeb.today can now be served from `./site/` from any static HTTP server.


#### Customizing Assets Path

Note that when running on Cloudflare, the static assets in `site/assets` and built scripts `site/dist` are served from a separate CDN (via DigitalOcean).

This path can be changed by rebuilding after changing `CDN_PREFIX` in `rollup.config.js`

The assets and scripts can be hosted on any static web storage.


### Customizations

The loading paths below can be changed by changing the settings in `rollup.config.js` and rerunning `yarn run build`.

#### Changing the Archive Source

Currently, OldWeb.today supports loading from [Internet Archive's Wayback Machine](https://web.archive.org/web/) and directly from the live web.
Support for additional / multiple archives is planned!

The archive source can be any web archive that supports Wayback Machine style unrewritten urls, eg: `<prefix>/<timestamp>id_/<url>`.
The archive must support returning unmodified content for it to work.

To run with a different web archive, simply change the `ARCHIVE_PREFIX` path to point to the wayback machine instance you wish to use.

If loading from a wayback machine hosted on the same domain, the CORS proxy may not be necessary.

For example, if running OldWeb.today on host `mywebarchive.example.com` and there is a wayback machine running at `https://mywebarchive.example.com/wayback/`, then you can set

```js

CORS_PREFIX = ""
ARCHIVE_PREFIX = "/wayback/"
```

If OldWeb.today is hotsed on a different site, then the config should be:

```js
CORS_PREFIX = "/proxy/"
ARCHIVE_PREFIX = "https://mywebarchive.example.com/wayback/"
```

### Changing Image and Asset Paths

All Emulator Images are hosted from a static block storage bucket (currently on DigitalOcean). If you wish to run with a local/different set of images, you can set:

```js
IMAGE_PREFIX = "https://mybucket.example.com/images`
```

To change the `assets` and `dist` paths (for cloudflare deployment), you can set:

```js
CDN_PREFIX = "https://mybucket.example.com/site`
```

### Changing / Adding Emulated Browsers

The availble browsers are configured in `src/config.json`, which contains the browser name, emulator type, images, saved state (for v86) and other options
or each browser. The `config.json` is interpolated with the `IMAGE_PREFIX` and served from `site/assets/config.json`.

To test a local emulator, create an entry w/o using the `IMAGE_PREFIX`. See `config.json` for more details. 

## Classic OldWeb.today

The "classic" version of oldweb.today, which uses Docker containers and emulators running on the server, can be found here: [classic.oldweb.today](http://classic.oldweb.today) Source: [https://github.com/oldweb-today/netcapsule](https://github.com/oldweb-today/netcapsule)


## LICENSE

OldWeb.today is available under the AGPL license. Other components (listed above) may be available under different licenses.

See [NOTICE.md](NOTICE.md) for more details.


## Contributing

Contributions are definitely welcome, but please open an issue before contributing additional browsers or emulators.


