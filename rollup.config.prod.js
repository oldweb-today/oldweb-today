import getConfig from "./rollup.config.js";

const opts = {
   // path to cors proxy
  corsPrefix: "https://wabac-cors-proxy.webrecorder.workers.dev/proxy/",

};

export default getConfig(opts);

