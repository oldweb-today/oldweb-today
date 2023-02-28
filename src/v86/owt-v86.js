import { LitElement, html, css } from 'lit-element';

const usePoll = true;
let preload = false;

const DEFAULT_MAC = [0x00, 0x22, 0x15, 0x10, 0x11, 0x12];


// ===========================================================================
export default class OWTV86Browser extends LitElement
{
  constructor() {
    super();
    this.lib86Url = "dist/libv86.js";

    this.emulator = null;
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
    let hda = null;

    preload = !this.opts.stateUrl;

    if (preload) {
      const resp = await fetch(this.opts.imageUrl);
      hda = {buffer: await resp.arrayBuffer()}
    } else {
      hda = {
        url: this.opts.imageUrl,
        async: true,
        size: this.opts.imageSize
      }
    }

    const initOpts =  {
      screen_container: emuDiv,
      memory_size: 512 * 1024 * 1024,
      vga_memory_size: 16 * 1024 * 1024,
      bios: {
          url:  this.opts.biosPath + "seabios.bin",
      },
      vga_bios: {
          url: this.opts.biosPath + "vgabios.bin",
      },
      hda,
      preserve_mac_from_state_image: true,
      acpi: !!this.opts.acpi,
      autostart: true,
      wasm_path: "dist/v86.wasm",
      network_adapter: (bus) => new V86Network(bus, this.url, this.ts, this.opts.clientIP, this.opts.clientMAC),
      mac_address: DEFAULT_MAC,
    };

    let stateLoad = false;

    if (this.opts.stateUrl) {
      try {
        const initial_state = await this.loadIncremental(this.opts.stateUrl);
        stateLoad = true;

        initOpts.initial_state = initial_state;

        //setTimeout(() => window.emulator.restore_state(initial_state), 100);
      } catch (e) {
        console.warn("Couldn't load state", e);
      }
    }

    this.emulator = new V86Starter(initOpts);
    window.emulator = this.emulator;

    if (!stateLoad) {
      setTimeout(() => {
        console.log("Cancel scandisk keycode sent");
        this.emulator.keyboard_send_scancodes([0x2D]);
      }, 3000);
    }
  }

  async loadIncremental(url) {
    const resp = await fetch(this.opts.stateUrl);
    if (resp.status !== 200) {
      throw new Error("Invalid state response");
    }
    const total = Number(resp.headers.get("x-amz-meta-full-content-length"));

    const reader = resp.body.getReader();

    const chunks = [];
    let count = 0;

    while(true) {
      const {done, value} = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
      count += value.length;

      console.log(`${count} of ${total}`);
      const detail = {count, total};
      this.dispatchEvent(new CustomEvent("dl-progress", {detail}));
    }

    this.dispatchEvent(new CustomEvent("dl-progress", {}));

    const buffer = new Uint8Array(count);

    count = 0;

    for (const chunk of chunks) {
      buffer.set(chunk, count);
      count += chunk.length;
    }

    return buffer;
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
    this.emulator.lock_mouse();
  }
}


// ===========================================================================
class V86Network
{
  constructor(bus, replayUrl, replayTs, clientIP, clientMAC) {
    console.log("URL", replayUrl);
    console.log("TS", replayTs);

    const recvCallback = usePoll ? null : (data) => this.recv(data);
    
    this.jsnet = new JSNet.JSNetClient({
      jsnetUrl: "dist/jsnet.js",
      replayTs, replayUrl, clientIP, clientMAC,
      recvCallback,
    });
    this.bus = bus;

    this.bus.register("net0-send", (data) => this.jsnet.send(data), this);

    if (usePoll) {
      this.loop = setInterval(() => this.recvLoop(), 10);
    }
  }

  recv(data) {
    this.bus.send("net0-receive", data);
  }

  recvLoop() {
    this.jsnet.pollRecv((data) => this.recv(data));
  }

  destroy() {
    clearInterval(this.loop);
  }
}

