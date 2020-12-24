import { LitElement, html, css } from 'lit-element';

const ARCHIVE_PREFIX = __ARCHIVE_PREFIX__;


export default class OWTNative extends LitElement
{
  constructor() {
    super();
    this.inited = false;
  }

  static get properties() {
    return {
      url: { type: String },
      ts: { type: String },
      opts: { type: Object },
      inited: { type: Boolean },
      iframeUrl: { type: String }
    }
  }

  firstUpdated() {
    this.initSW();
  }

  updated(changedProps) {
    if (changedProps.has("url") || changedProps.has("ts")) {
      if (this.url && (this.url !== this.actualUrl || changedProps.has("ts"))) {
        this.dispatchEvent(new CustomEvent("load-started"));
        this.iframeUrl = `/wabac/live/${this.ts}mp_/${this.url}`;
      }
    }
  }

  async initSW() {
    const scope = "./";

    await navigator.serviceWorker.register("./sw.js", {scope});

    navigator.serviceWorker.addEventListener("message", (event) => {
      this.inited = true;
    });

    const baseUrl = new URL(window.location);
    baseUrl.hash = "";

    const msg = {
      msg_type: "addColl",
      name: "live",
      type: "live",
      file: {"sourceUrl": "proxy:/proxy/"},
      skipExisting: false,
      extraConfig: {
        "prefix": "/proxy/", 
        "isLive": false,
        "archivePrefix": ARCHIVE_PREFIX,
        "injectScripts": this.opts.injectScripts,
        "baseUrl": baseUrl.href,
        "baseUrlHashReplay": true
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

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.inited || !this.iframeUrl) {
      return html``;
    }

    return html`
      <iframe class="native-frame" src="${this.iframeUrl}"
      @load="${this.onFrameLoad}" allow="autoplay 'self'; fullscreen" allowfullscreen
      ></iframe> 
    `;
  }

  onFrameLoad(event) {
    const detail = {};

    try {
      //const iframe = this.renderRoot.querySelector("iframe");
      detail.url = event.currentTarget.contentWindow.WB_wombat_location.href;
      this.actualUrl = detail.url;
    } catch(e) {
      console.log(e);
    }

    this.dispatchEvent(new CustomEvent("load-finished", {detail}));
  }
}