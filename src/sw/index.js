import { SWReplay } from "@webrecorder/wabac/src/swmain.js";
//import { WorkerLoader } from "./loaders.js";

if (self.registration) {
// Service Worker Init
  self.sw = new SWReplay();
  console.log("sw init");
}


