import { LitElement, html, css } from 'lit-element';

import OWTV86Browser from './v86/owt-v86';
import OWTBasBrowser from './bas/owt-bas';





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
      this.updateChannel.onmessage = () => {
        this.showUrlUpdateMessage = false;
        this.showTsUpdateMessage = false;
        this.isLoading = false;
      };
    }

    this.dlProgress = 0;
    this.dlProgressTotal = 0;

    this.loadConfig();
  }

  async loadConfig() {
    const resp = await fetch("./assets/config.json");
    this.emuOptions = await resp.json();

    for (const emu of this.emuOptions) {
      this.emuMap[emu.id] = emu;
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
    }
  }

  get isRunning() {
    return !!this.launchID;
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
        this.updateChannel.postMessage({replayUrl: this.replayUrl});
        this.showUrlUpdateMessage = true;
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
    if (this.unsupported) {
      return html`<div class="err">Sorry, OldWeb.today can not run in this browser. Please try the latest version of Chrome or Firefox.</div>`;
    }

    if (!this.launchID) {
      return html`<div class="err">Please select a browser from the list.</div>`;
    }

    if (!this.emuOptions.length) {
      return html`<div class="err"><div class="loading loading-lg"></div>Loading Browser Config...</div>`;
    }

    const emu = this.emuMap[this.launchID];

    if (!emu) {
      return html`<div class="err">Not a valid browser. Please select a browser.</div>`;
    }

    if (emu.emu === "v86") {
      return html`<owt-v86-browser @dl-progress="${this.onDownload}" .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}"></owt-v86-browser>`;
    } else if (emu.emu === "bas") {
      return html`<owt-bas-browser @dl-progress="${this.onDownload}" .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}"></owt-bas-browser>`;
    } else {
      return html`<div class="err">Unknown emulator type: ${emu.emu}</div>`;
    }
  }

  render() {
    const currEmu = this.emuMap[this.browserID];

    return html`
      <div class="container">
        <div class="columns">
          <div class="column controls">
            <div>
              <h2 class="owt-title">OldWeb.Today</h2>
              <i class="full-width" style="text-align: center; display: block">JS Browser Emulation <img src="./assets/new.gif"/></i>
              <div class="form-group">
                <label for="browser" class="form-label space-top">Browser:</label>

                <div class="dropdown full-width">
                  <a class="btn dropdown-toggle" tabindex="0">
                    <span class="curr-browser">
                      ${currEmu ? html`
                          <img width="24" height="24" src="./assets/icons/${currEmu.icon}"/>
                          <img style="margin-left: 0.5em" width="24" height="24" src="./assets/icons/${currEmu.os}.png"/>
                          <span style="margin-left: 0.5em; vertical-align: super;">${currEmu.name}</span>
                      `: 'Select a Browser'}</span>
                    <i class="icon icon-caret" style="vertical-align: baseline"></i>
                  </a>
                  <ul class="menu" style="width: 234px">
                    ${this.emuOptions.map((emu, i) => html`
                      ${emu.hidden ? html`` : html`
                      <li class="menu-item" style="">
                        <a style="display: flex" @click="${(e) => this.onSelectBrowser(e, emu)}" tabIndex="${i + 1}">
                          <img width="24" height="24" src="./assets/icons/${emu.icon}"/>
                          <img style="margin-left: 1.0em" width="24" height="24" src="./assets/icons/${emu.os}.png"/>
                          <span style="margin-left: 1.5em; vertical-align: super;">${emu.name}</span>
                        </a>
                      </li>`}
                    `)}
                  </ul>
                </div>

                <form @submit="${this.onUrlUpdate}" class="space-top">
                  <label class="form-label" for="url">URL:</label>
                  <input class="form-input" type="url" id="url" .value="${this.replayUrl}" placeholder="http://example.com/"></input>
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
                  <summary>Available Archives</summary>
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
            <div class="by-wr">
              <p>
                <a href="https://github.com/webrecorder/oldweb-today.js" target="_blank">How it Works / View Source</a>
              </p>
              <p>
                <a href="http://classic.oldweb.today/" target="_blank">Classic OldWeb.today</a>
              </p>
              <span>A project by:</span>
              <a href="https://webrecorder.net/" target="_blank">
                <img class="logo" src="assets/wrLogo.png"/>
              </a>
            </div>
          </div>
          <div class="column" style="margin-right: 0px">
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

    window.emulator.save_state((err, buff) => {
      if (err) {
        console.log(err);
        return;
      }

      const blob = new Blob([buff]);

      const a = document.createElement("a");
      a.download = "state.bin";
      a.href = window.URL.createObjectURL(blob);
      a.dataset["downloadurl"] = ["application/octet-stream", a.download, a.href].join(":");

      a.click();

      window.URL.revokeObjectURL(a.href);
    });
  }
}

customElements.define("oldweb-today", OldWebToday);
customElements.define("owt-v86-browser", OWTV86Browser);
customElements.define("owt-bas-browser", OWTBasBrowser);
