import {WritableStream, ReadableStream} from "web-streams-polyfill/ponyfill/es6";

if (!self.WritableStream) {
  self.WritableStream = WritableStream;

  // also need to polyfill ReadableStream as it likely doesn't support pipeTo/Through if no WritableStream
  self.ReadableStream = ReadableStream;
}


