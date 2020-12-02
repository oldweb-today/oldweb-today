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

    this.showUpdateMessage = false;

    this.emuOptions = [];
    this.emuMap = {};

    this.updateChannel = new BroadcastChannel("update-proxy");
    this.updateChannel.onmessage = () => {
      this.showUpdateMessage = false;
      this.isLoading = false;
    };

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
      showUpdateMessage: { type: Boolean },
      emuOptions: { type: Array }
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

    if (this.isRunning && changedProps.has("replayTs") && !this.isLoading) {
      this.updateChannel.postMessage({replayTs: this.replayTs});

      this.showUpdateMessage = true;
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

    if (hashchange && this.isRunning && this.replayUrl !== this.launchReplayUrl) {
      window.location.reload();
    }
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
      return html`<div class="err">Please select a browser from the list.</div>`;
    }

    if (!this.emuOptions.length) {
      return html`<div class="err">Loading Browser Config...</div>`;
    }

    const emu = this.emuMap[this.launchID];

    if (!emu) {
      return html`<div class="err">Not a valid browser. Please select a browser.</div>`;
    }

    if (emu.type === "v86") {
      return html`<owt-v86-browser .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}"></owt-v86-browser>`;
    } else if (emu.type === "bas") {
      return html`<owt-bas-browser .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}"></owt-bas-browser>`;
    }
  }

  render() {
    return html`
      <div class="container">
        <div class="columns">
          <div class="column controls">
            <h2 class="owt-title">OldWeb.Today</h2>
            <i class="full-width" style="text-align: center; display: block">JS Browser Emulation</i>
            <div class="form-group">
              <label for="browser" class="form-label space-top">Browser:</label>

              <div class="dropdown full-width">
                <a class="btn dropdown-toggle" tabindex="0">
                  <span style="font-size: smaller">${this.emuMap[this.browserID] ? this.emuMap[this.browserID].name : 'Select a Browser'}</span>
                  <i class="icon icon-caret"></i>
                </a>
                <ul class="menu full-width">
                  ${this.emuOptions.map((emu, i) => html`
                    ${emu.hidden ? html`` : html`
                    <li class="menu-item">
                      <a @click="${(e) => this.onSelectBrowser(e, emu)}" tabIndex="${i + 1}">${emu.name}</a>
                    </li>`}
                  `)}
                </ul>
              </div>

              <form @submit="${this.onUrlUpdate}" class="space-top">
                <label class="form-label" for="url">URL</label>
                <input class="form-input" type="url" id="url" .value="${this.replayUrl}" placeholder="http://example.com/"></input>
              </form>              

              <label class="form-radio space-top" style="padding-right: 0">
                <input @click="${(e) => this.replayTs = this.inputTs}" type="radio" name="islive" ?checked="${!!this.replayTs}">
                <i class="form-icon"></i>Load Archived at Date:
              </label>
              <input class="form-input" type="datetime-local" id="dt" ?disabled="${!this.replayTs}"
                @change="${this.onChangeTs}" .value="${this.tsToDateMin(this.inputTs)}"></input>

              <label class="form-radio">
                <input @click="${(e) => this.replayTs = ""}" type="radio" name="islive" ?checked="${!this.replayTs}">
                <i class="form-icon"></i>Load from Live Web
              </label>

              ${this.showUpdateMessage ? html`
                <div class="msg" style="background-color: aliceblue">
                  Date Updated!<br/>Refresh or reload the emulated browser to start browsing at the new date.
                </div>` : html``}

              ${this.isRunning ? html`
                <div style="margin: 1em 0">
                  ${!this.isLoading ? html`
                  <i>Emulated Browser is Running!</i>` : html`
                  <div class="loading loading-lg"></div><i>Please wait, Emulated Browser is Loading...</i>`}
                  <button class="btn btn-sm" @click="${this.onCancel}">Stop</button>
                </div>
                ` : ``}

              ${this.isRunning && this.emuMap[this.launchID] && this.emuMap[this.launchID].hidden ? html`
              <button @click="${this.onDL}">Save State</button>` : ''}

            </div>
          </div>
          <div class="column" style="margin-right: 0px">
            ${this.renderEmulator()}
          </div>
        </div>
      </div>
    `;
  }

  onLaunch() {
    window.location.reload();
  }

  onSelectBrowser(event, emu) {
    this.browserID = emu.id;
  }

  onUrlUpdate(event) {
    event.preventDefault();
    this.replayUrl = this.renderRoot.querySelector("#url").value;
    if (this.isRunning && this.replayUrl !== this.launchReplayUrl) {
      window.location.reload();
    }
  }

  onChangeTs(event) {
    this.inputTs = event.currentTarget.value.replace(/[^\d]/g, "") + "00";
    if (this.isRunning) {
      this.replayTs = this.inputTs;
    }
  }

  tsToDateMin(ts) {
    if (!ts) {
      return "";
    }
  
    if (ts.length < 12) {
      ts += "000001010000".substr(ts.length);
    }
  
    const datestr = (ts.substring(0, 4) + "-" +
      ts.substring(4, 6) + "-" +
      ts.substring(6, 8) + "T" +
      ts.substring(8, 10) + ":" +
      ts.substring(10, 12));
  
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
