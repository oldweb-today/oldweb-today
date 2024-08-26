import { LitElement, html, css } from 'lit-element';

import OWTV86Browser from './v86/owt-v86';
import OWTBasBrowser from './bas/owt-bas';
import OWTNative from './native/owt-native';
//import OWTHalfixBrowser from './halfix/owt-halfix';

const ARCHIVE_PREFIX = __ARCHIVE_PREFIX__;

const PROXY_PREFIX = __CORS_PREFIX__;


// ===========================================================================
class OldWebToday extends LitElement
{
  constructor() {
    super();

    this.emuMap = {};

    this.replayUrl = "http://example.com/";
    this.replayTs = "";
    this.inputTs = "";
    this.launchReplayUrl = "";
    this.browserID = "";
    this.launchID = "";
    this.isLoading = false;

    this.showUrlUpdateMessage = false;
    this.showTsUpdateMessage = false;

    this.emuOptions = [];
    this.emuMap = {};

    this.unsupported = (!self.BroadcastChannel || !self.SharedArrayBuffer);

    if (self.BroadcastChannel) {
      this.updateChannel = new BroadcastChannel("update-proxy");
      this.updateChannel.onmessage = () => this.onClearUpdateNeeded();
    }

    this.dlProgress = 0;
    this.dlProgressTotal = 0;

    this.inited = false;
    this.initSW();

    this.loadConfig();
  }

  async loadConfig() {
    const resp = await fetch("./assets/config.json");
    this.emuOptions = await resp.json();

    for (const emu of this.emuOptions) {
      this.emuMap[emu.id] = emu;
    }
  }

  async initSW() {
    const scope = "./";

    const hadSW = !!navigator.serviceWorker.controller;

    await navigator.serviceWorker.register("./sw.js", {scope});

    navigator.serviceWorker.addEventListener("message", (event) => {
      this.inited = true;
      if (this.unsupported && !hadSW) {
        window.location.reload();
      }
    });

    const baseUrl = new URL(window.location);
    baseUrl.hash = "";

    const msg = {
      msg_type: "addColl",
      name: "live",
      type: "live",
      file: {"sourceUrl": `proxy://live`},
      skipExisting: false,
      extraConfig: {
        "prefix": PROXY_PREFIX,
        "isLive": false,
        "archivePrefix": ARCHIVE_PREFIX,
        //"injectScripts": ["dist/ruffle.js"],
        "baseUrl": baseUrl.href,
        "baseUrlHashReplay": true,
        "coHeaders": true,
      },
    };

    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", (event) => {
        navigator.serviceWorker.controller.postMessage(msg);
      });
    } else {
      navigator.serviceWorker.controller.postMessage(msg);
    }
  }

  static get properties() {
    return {
      replayUrl: { type: String },
      replayTs: { type: String },
      inputTs: { type: String },
      isLoading: { type: Boolean },
      launchID: { type: String },
      browserID: { type: String },
      showUrlUpdateMessage: { type: Boolean },
      showTsUpdateMessage: { type: Boolean },
      emuOptions: { type: Array },
      unsupported: { type: Boolean },
      dlProgress: { type: Number },
      dlProgressTotal: { type: Number },
      inited: { type: Boolean },
    }
  }

  get isRunning() {
    return !!this.launchID;
  }

  onClearUpdateNeeded(event) {
    this.showUrlUpdateMessage = false;
    this.showTsUpdateMessage = false;
    this.isLoading = false;

    if (event && event.detail && event.detail.url) {
      this._internalUpdate = true;
      this.replayUrl = event.detail.url;
    }
  }

  onStartLoading() {
    this.showUrlUpdateMessage = false;
    this.showTsUpdateMessage = false;
    this.isLoading = true;
  }

  firstUpdated() {
    if (!window.location.hash) {
      window.location.hash = "#/19960101/http://geocities.com/";
    }

    this.parseOpts();
    window.addEventListener("hashchange", () => this.parseOpts(true));
    window.addEventListener("popstate", () => this.parseOpts());

    // start running only on initial load
    this.launchID = this.browserID;
    this.isLoading = this.isRunning;
    this.launchReplayUrl = this.replayUrl;

    this.inputTs = this.replayTs || "19960101";
  }

  updated(changedProps) {
    if (changedProps.has("replayUrl") || changedProps.has("replayTs")) {
      this.updateHash();
    }

    if (this.isRunning && !this.isLoading) {
      if (changedProps.has("replayTs")) {
        this.updateChannel.postMessage({replayTs: this.replayTs});
        this.showTsUpdateMessage = true;
      }

      if (changedProps.has("replayUrl")) {
        if (!this._internalUpdate) {
          this.updateChannel.postMessage({replayUrl: this.replayUrl});
          this.showUrlUpdateMessage = true;
        }
        this._internalUpdate = false;
      }
    }

    if (changedProps.has("browserID")) {
      this.updateQuery();
    }
  }

  createRenderRoot() {
    return this;
  }

  parseOpts(hashchange) {
    const query = new URL(window.location.href).searchParams;
    this.browserID = query.get("browser");

    const m = window.location.hash.slice(1).match(/\/?(?:([\d]+)\/)?(.*)/);
    if (m) {
      this.replayTs = m[1] || "";
      this.replayUrl = m[2] || "http://example.com/";
    }

    // if (hashchange && this.isRunning && this.replayUrl !== this.launchReplayUrl) {
    //   window.location.reload();
    // }
  }

  updateHash() {
    let string = "#";
    if (this.replayTs) {
      string += this.replayTs + "/";
    }
    string += this.replayUrl;
    window.location.hash = string;
  }

  updateQuery() {
    const url = new URL(window.location.href);
    if (this.browserID) {
      url.searchParams.set("browser", this.browserID);
    } else {
      url.searchParams.delete("browser");
    }

    //window.history.pushState({}, "OldWeb.Today Emulated Browsers", url.href);
    if (window.location.href !== url.href) {
      window.location.href = url.href;
    }
  }

  renderEmulator() {
    if (!this.launchID) {
      return html`
      <div class="err">Please <b>select a browser</b> from the list to start! Many browsers support Flash or Java emulation.</div>`;
    }

    if (!this.emuOptions.length) {
      return html`<div class="err"><div class="loading loading-lg"></div>Loading Browser Config...</div>`;
    }

    const emu = this.emuMap[this.launchID];

    if (!emu) {
      return html`<div class="err">Not a valid browser. Please select a browser.</div>`;
    }

    if (!this.inited) {
      return html`<div class="err">Initializing, please wait...</div>`;
    }

    if (this.unsupported && (emu.emu !== "native")) {
      return html`<div class="err">Sorry, OldWeb.today can not run in this emulator in your current browser. Please try the latest version of Chrome or Firefox to use this emulator.
      <br/>The Ruffle emulator may still work.</div>`;
    }

    if (emu.emu === "v86") {
      return html`
      <owt-v86-browser
      @dl-progress="${this.onDownload}"
      .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}">
      </owt-v86-browser>`;

    } else if (emu.emu === "bas") {
      return html`
      <owt-bas-browser @dl-progress="${this.onDownload}"
      .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}">
      </owt-bas-browser>`;

    } else if (emu.emu === "halfix") {
      return html`
      <owt-halfix-browser @dl-progress="${this.onDownload}"
      .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}">
      </owt-halfix-browser>`;

    } else if (emu.emu === "native") {
      return html`
      <owt-native @dl-progress="${this.onDownload}"
      @load-started="${this.onStartLoading}"
      @load-finished="${this.onClearUpdateNeeded}"
      .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}">
      </owt-native>`;

    } else {
      return html`<div class="err">Unknown emulator type: ${emu.emu}</div>`;
    }
  }

  renderEmuLabel(emu) {
    return html`
    ${emu.os !== 'native' ? html`
    <img width="24" height="24" src="./assets/icons/${emu.icon}"/>
    <img style="margin-left: 1.0em" width="24" height="24" src="./assets/icons/${emu.os}.png"/>` : html`

    <span class="icon-fill"></span>
    <img width="24" height="24" src="./assets/icons/${emu.icon}"/>
    `}

    <span class="browser-label">${emu.name}</span>

    ${emu.features ? html`
    <span class="browser-features">
    ${emu.features.map((f) => html`<span>${f}</span>`)}
    </span>` : ``}
    `;
  }

  render() {
    const currEmu = this.emuMap[this.browserID];

    return html`
      <div class="container">
        <div class="columns">
          <div class="column controls">
            <div>
              <h2 class="owt-title">OldWeb.Today</h2>
              <i class="full-width" style="text-align: center; display: block">JS Browser Emulation <img src="./assets/new.gif"/ alt="new"></i>
              <div class="form-group">
                <label for="browser" class="form-label space-top">Browser / Emulator:</label>

                <div class="dropdown full-width browser">
                  <a class="btn dropdown-toggle" tabindex="0">
                    <span class="curr-browser">
                      ${currEmu ? this.renderEmuLabel(currEmu): 'Select a Browser'}
                      <i class="icon icon-caret" class="caret"></i>
                    </span>
                  </a>
                  <ul id="browser-menu" class="menu">
                    ${this.emuOptions.map((emu, i) => html`
                      ${emu.hidden ? html`` : html`
                      <li class="menu-item" style="">
                        <a style="display: flex" @click="${(e) => this.onSelectBrowser(e, emu)}" tabIndex="${i + 1}">
                          ${this.renderEmuLabel(emu)}
                        </a>
                      </li>`}
                    `)}
                  </ul>
                </div>

                <form @submit="${this.onUrlUpdate}" class="space-top">
                  <label class="form-label" for="url">URL:</label>
                  <input @change="${this.onUrlUpdate}" class="form-input" type="url" id="url" .value="${this.replayUrl}" placeholder="http://example.com/"></input>
                </form>

                ${this.showUrlUpdateMessage ? html`
                <div class="msg" style="background-color: aliceblue">
                  Home Page URL Updated!<br/>Click the <i>Home</i> button in the emulated browser to load the new URL.
                </div>` : html``}

                <label class="form-radio space-top">
                  <input @click="${(e) => this.replayTs = ""}" type="radio" name="islive" ?checked="${!this.replayTs}">
                  <i class="form-icon"></i>Browse Live Web
                </label>

                <label class="form-radio" style="padding-right: 0">
                  <input @click="${(e) => this.replayTs = this.inputTs}" type="radio" name="islive" ?checked="${!!this.replayTs}">
                  <i class="form-icon"></i>Browse Archives At:
                </label>

                <input @change="${this.onChangeTs}" class="form-input" type="text" id="dt" ?disabled="${!this.replayTs}"
                  .value="${this.tsToDateMin(this.inputTs)}" placeholder="YYYY-MM-DD hh:mm:ss"></input>

                ${!!this.replayTs ? html`
                <details>
                  <summary>Web Archive Sources</summary>
                  <div>
                  <label class="form-checkbox">
                    <input type="checkbox" disabled checked>
                    <i class="form-icon"></i>Internet Archive
                    <p style="font-size: 0.75em">More options coming soon...</p>
                  </label>
                  </div>
                </details>` : ``}

                ${this.showTsUpdateMessage ? html`
                  <div class="msg" style="background-color: aliceblue">
                    Date Updated!<br/>Click the <i>Refresh</i> button or load a new page in the emulated browser to start browsing at the new date.
                  </div>` : html``}

                ${this.isRunning ? html`
                  <div style="margin: 1em 0">
                    <p>${!this.isLoading ? html`
                    <i>Status: Running</i>` : html`
                    <div class="loading loading-lg"></div>
                    ${this.dlProgressTotal ? html`
                    <i>Status: Downloading...</i>
                    <progress class="progress" value="${this.dlProgress}" max="${this.dlProgressTotal}"></progress>
                    ` : html`
                    <i>Status: Loading, please wait...</i>`}
                    `}</p>

                    <button class="btn btn-sm" @click="${this.onCancel}"><i class="icon icon-cross"></i>&nbsp;Stop</button>
                    <button class="btn btn-sm" @click="${(e) => window.location.reload()}"><i class="icon icon-refresh"></i>&nbsp;Reload</button>
                  </div>
                  ` : ``}

                ${this.isRunning && this.emuMap[this.launchID] && this.emuMap[this.launchID].hidden ? html`
                <button @click="${this.onDL}">Save State</button>` : ''}
              </div>
            </div>
            <div class="sidebar-centered-text-container" style="margin-top: 1.2rem">
              <div style="font-size: 1.1em; padding: 0.5rem; border-radius: 4px; background-color: #eee;">
                  <p style="margin-bottom: 0.35rem"><strong>Want to make your own web archives?</strong></p>
                  <p style="margin: 0px">
                  Check out:
                  <br/>
                  <a href="https://browsertrix.com" target="_blank"><img class="logo" src="assets/browsertrix-lockup-color.svg" alt="Browsertrix"/></a>
                  </p>
              </div>
              <div style="font-size: 1.1em; padding: 0.5rem; border-radius: 4px; background-color: #eee; margin-top: 0.5rem;">
                <p style="margin-bottom: 0.35rem"><strong>❤️  Love OldWeb.today?</strong></p>
                <p style="margin: 0px">
                Support Webrecorder via:
                <br/><b><a href="https://opencollective.com/webrecorder" target="_blank">OpenCollective</a></b>
                / <b><a href="https://github.com/sponsors/webrecorder" target="_blank">GitHub</a></b>
                </p>
              </div>
              <p style="margin-top: 1.0rem">
                <a href="https://github.com/oldweb-today/oldweb-today" target="_blank">View Source on GitHub</a>
              </p>
              <span>A project by:</span>
              <a href="https://webrecorder.net/" target="_blank">
                <img class="logo" src="assets/wrLogo.png" alt="Webrecorder"/>
              </a>
            </div>
          </div>
          <div class="column" style="display:flex; justify-content: center;">
            ${this.renderEmulator()}
          </div>
        </div>
      </div>
    `;
  }

  onSelectBrowser(event, emu) {
    this.browserID = emu.id;
  }

  onUrlUpdate(event) {
    event.preventDefault();
    this.replayUrl = this.renderRoot.querySelector("#url").value;
    // if (this.isRunning && this.replayUrl !== this.launchReplayUrl) {
    //   window.location.reload();
    // }
  }

  onDownload(event) {
    if (event.detail) {
      this.dlProgressTotal = event.detail.total;
      this.dlProgress = event.detail.count;
    } else {
      this.dlProgressTotal = 0;
    }
  }

  onChangeTs(event) {
    this.inputTs = event.currentTarget.value.replace(/[^\d]/g, "");
    if (this.isRunning) {
      this.replayTs = this.inputTs;
    }
  }

  tsToDateMin(ts) {
    if (!ts) {
      return "";
    }
  
    if (ts.length < 14) {
      ts += "00000101000000".substr(ts.length);
    }
  
    const datestr = (ts.substring(0, 4) + "-" +
      ts.substring(4, 6) + "-" +
      ts.substring(6, 8) + " " +
      ts.substring(8, 10) + ":" +
      ts.substring(10, 12) + ":" +
      ts.substring(12, 14));
  
    return datestr;
  };

  onCancel() {
    this.browserID = "";
  }

  onDL() {
    if (!window.emulator) {
      return;
    }

    window.emulator.stop();

    window.emulator.save_state((err, buff) => {
      if (err) {
        console.log(err);
        return;
      }

      const blob = new Blob([buff]);

      const a = document.createElement("a");
      a.download = "savestate.bin";
      a.href = window.URL.createObjectURL(blob);
      a.dataset["downloadurl"] = ["application/octet-stream", a.download, a.href].join(":");

      a.click();

      window.URL.revokeObjectURL(a.href);

      window.emulator.run();
    });
  }
}

customElements.define("oldweb-today", OldWebToday);
customElements.define("owt-v86-browser", OWTV86Browser);
customElements.define("owt-bas-browser", OWTBasBrowser);
//customElements.define("owt-halfix-browser", OWTHalfixBrowser);
customElements.define("owt-native", OWTNative);
