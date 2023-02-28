import { LitElement, html, css } from 'lit-element';


export default class OWTNative extends LitElement
{
  static get properties() {
    return {
      url: { type: String },
      ts: { type: String },
      opts: { type: Object },
      iframeUrl: { type: String }
    }
  }

  updated(changedProps) {
    if (changedProps.has("url") || changedProps.has("ts")) {
      if (this.url && (this.url !== this.actualUrl || changedProps.has("ts"))) {
        this.dispatchEvent(new CustomEvent("load-started"));
        this.iframeUrl = `/w/live/${this.ts}mp_/${this.url}`;
      }
    }
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.iframeUrl) {
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
