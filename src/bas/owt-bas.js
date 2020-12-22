import { LitElement, html, css } from 'lit-element';

import bas_main from './bas-main';

export default class OWTBasiliskII extends LitElement
{
  constructor() {
    super();
  }

  static get properties() {
    return {
      url: { type: String },
      ts: { type: String },
      opts: { type: Object }
    }
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    bas_main({
      replayUrl: this.url,
      replayTs: this.ts,
      opts: this.opts,
      canvas: ".bas-canvas",
      width: 1024,
      height: 720,
    }, this);
  }

  render() {
    return html`
      <canvas width="640" height="480" id="canvas" class="bas-canvas" oncontextmenu="event.preventDefault()"></canvas>
    `;
  }
}


