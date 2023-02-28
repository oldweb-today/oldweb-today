import RingBuffer from "sab-ring-buffer/ringbuffer.js";


export class JSNetClient
{
  constructor({
      replayUrl = "",
      replayTs = "",
      proxyIP = "10.0.2.2",
      proxyPort = 6082,
      jsnetUrl = "jsnet.js",
      clientMAC = null,
      clientIP = null,
      recvCallback = null
  }) {
    this.netWorker = new Worker(jsnetUrl);

    this.eth_from_emu = new BroadcastChannel("eth_from_emu");

    this.netChannel = new MessageChannel();

    this.netrb = null;

    if (replayUrl.startsWith("https://")) {
      replayUrl = replayUrl.replace("https://", "http://");
    }
    if (!replayUrl.startsWith("http://")) {
      replayUrl = "http://" + replayUrl;
    }

    this.netRecvBuffer = null;

    this.netWorker.postMessage({
      port: this.netChannel.port1,
      replayUrl,
      replayTs,
      proxyIP,
      proxyPort,
      clientIP,
      clientMAC,
      pollSAB: !recvCallback,
    }, [this.netChannel.port1]);

    if (!recvCallback) {
      this.netChannel.port2.onmessage = (event) => {
        console.log("got shared ringbuffer", event.data);
        this.netrb = RingBuffer.from(event.data);
      }
    } else {
      this.eth_to_emu = new BroadcastChannel("eth_to_emu");
      this.eth_to_emu.onmessage = (event) => recvCallback(event.data);
    }
  }

  pollRecv(targetBufferOrFunc, writeOffset = 0) {
    if (!this.netrb) {
      return 0;
    }

    let netRecvBuffer = this.netRecvBuffer;

    if (!netRecvBuffer || this.netRecvBuffer.byteLength === 0) {
      netRecvBuffer = new Uint8Array([...this.netrb.readToHead()]);
    }

    if (netRecvBuffer.byteLength > 0) {
      const size = new DataView(netRecvBuffer.buffer, netRecvBuffer.byteOffset, netRecvBuffer.byteLength).getUint16(0);
      const chunk = netRecvBuffer.slice(2, 2 + size);

      //console.log(`Emu Receive ${chunk.byteLength}`);
      if (typeof(targetBufferOrFunc) === "function") {
        targetBufferOrFunc(chunk);
      } else {
        targetBufferOrFunc.set(chunk, writeOffset);
      }

      this.netRecvBuffer = netRecvBuffer.slice(2 + size);

      return size;
    }

    return 0;
  }

  send(buffer) {
    this.eth_from_emu.postMessage(buffer);
  }
}



