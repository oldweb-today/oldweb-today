import { LitElement, html, css } from 'lit-element';


// ===========================================================================
export default class OWTV86Browser extends LitElement
{
  constructor() {
    super();
    this.lib86Url = "dist/libv86.js";
  }

  createRenderRoot() {
    return this;
  }

  static get properties() {
    return {
      url: { type: String },
      ts: { type: String },
      opts: { type: Object }
    }
  }

  firstUpdated() {
    if (!window.V86Starter) {
      const script = document.createElement("script");
      script.src = this.lib86Url;
      script.onload = () => this.initEmu();
      document.head.appendChild(script);
    } else {
      this.initEmu();
    }
  }

  async initEmu() {
    const emuDiv = this.renderRoot.querySelector("#emu");

    const initOpts =  {
      screen_container: emuDiv,
      memory_size: 192 * 1024 * 1024,
      vga_memory_size: 16 * 1024 * 1024,
      bios: {
          url: this.opts.imagePath + "seabios.bin",
      },
      vga_bios: {
          url: this.opts.imagePath + "vgabios.bin",
      },
      hda: {
          url: this.opts.imageUrl,
          async: true,
          size: this.opts.imageSize
      },
      autostart: true,
      network_adapter: (bus) => new V86Network(bus, this.url, this.ts, this.opts.clientIP, this.opts.clientMAC)
    };

    let stateLoad = false;

    if (this.opts.stateUrl) {
      try {
        const resp = await fetch(this.opts.stateUrl);
        if (resp.status !== 200) {
          throw new Error("Invalid state response");
        }
        const initial_state = await resp.arrayBuffer();
        stateLoad = true;

        initOpts.initial_state = initial_state;

        //setTimeout(() => window.emulator.restore_state(initial_state), 100);
      } catch (e) {
        console.warn("Couldn't load state", e);
      }
    }

    window.emulator = new V86Starter(initOpts);

    if (!stateLoad) {
      setTimeout(() => {
        console.log("Cancel scandisk keycode sent");
        window.emulator.keyboard_send_scancodes([0x2D]);
      }, 3000);
    }
  }

  render() {
    return html`
      <div id="emu">
        <div id="screen"></div>
        <canvas @click="${this.captureMouse}" id="vga"></canvas>
      </div>
    `;
  }

  captureMouse() {
    window.emulator.lock_mouse();
  }
}


// ===========================================================================
class V86Network
{
  constructor(bus, replayUrl, replayTs, clientIP, clientMAC) {
    console.log("URL", replayUrl);
    console.log("TS", replayTs);
    
    this.jsnet = new JSNetClient({
      jsnetUrl: "dist/jsnet.js",
      replayTs, replayUrl, clientIP, clientMAC});
    this.bus = bus;

    this.bus.register("net0-send", (data) => this.jsnet.send(data), this);

    this.loop = setInterval(() => this.recvLoop(), 10);
  }

  recvLoop() {
    this.jsnet.pollRecv((data) => {
      this.bus.send("net0-receive", data);
    });
  }

  destroy() {
    clearInterval(this.loop);
  }
}

