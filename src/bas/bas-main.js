export default function bas_main(config = {}, progressTarget) {

  var SCREEN_WIDTH = parseInt(config.width) || 800;
  var SCREEN_HEIGHT = parseInt(config.height) || 600;

  var canvas = document.querySelector(config.canvas);

  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;

  var audio = {
    channels: 1,
    bytesPerSample: 2,
    samples: 4096,
    // freq: 11025,
    freq: 22050,
    // freq: 44100,
    format: 0x8010,
    paused: false,
    timer: null,
    silence: 0,
    maxBuffersInSharedMemory: 5,
    nextPlayTime: 0,
  };

  var audioTotalSamples = audio.samples * audio.channels;
  audio.bytesPerSample =
    audio.format == 0x0008 /*AUDIO_U8*/ || audio.format == 0x8008 /*AUDIO_S8*/
      ? 1
      : 2;
  audio.bufferSize = audioTotalSamples * audio.bytesPerSample;
  audio.bufferDurationSecs =
    audio.bufferSize / audio.bytesPerSample / audio.channels / audio.freq; // Duration of a single queued buffer in seconds.
  audio.bufferingDelay = 50 / 1000; // Audio samples are played with a constant delay of this many seconds to account for browser and jitter.

  // To account for jittering in frametimes, always have multiple audio buffers queued up for the audio output device.
  // This helps that we won't starve that easily if a frame takes long to complete.
  audio.numSimultaneouslyQueuedBuffers = 5;
  audio.nextChunkIndex = 0;

  var SCREEN_BUFFER_SIZE = SCREEN_WIDTH * SCREEN_HEIGHT * 4; // 32bpp;

  var canvasCtx = canvas.getContext('2d');
  var imageData = canvasCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

  var screenBuffer = new SharedArrayBuffer(SCREEN_BUFFER_SIZE);
  var screenBufferView = new Uint8Array(screenBuffer);

  var VIDEO_MODE_BUFFER_SIZE = 10;
  var videoModeBuffer = new SharedArrayBuffer(VIDEO_MODE_BUFFER_SIZE * 4);
  var videoModeBufferView = new Int32Array(videoModeBuffer);

  var AUDIO_CONFIG_BUFFER_SIZE = 10;
  var audioConfigBuffer = new SharedArrayBuffer(AUDIO_CONFIG_BUFFER_SIZE);
  var audioConfigBufferView = new Uint8Array(audioConfigBuffer);

  var audioBlockChunkSize = audio.bufferSize + 2;
  var AUDIO_DATA_BUFFER_SIZE =
    audioBlockChunkSize * audio.maxBuffersInSharedMemory;
  var audioDataBuffer = new SharedArrayBuffer(AUDIO_DATA_BUFFER_SIZE);
  var audioDataBufferView = new Uint8Array(audioDataBuffer);

  var INPUT_BUFFER_SIZE = 100;
  var inputBuffer = new SharedArrayBuffer(INPUT_BUFFER_SIZE * 4);
  var inputBufferView = new Int32Array(inputBuffer);
  var inputQueue = [];

  var Atomics_notify = Atomics.wake || Atomics.notify;

  var InputBufferAddresses = {
    globalLockAddr: 0,
    mouseMoveFlagAddr: 1,
    mouseMoveXDeltaAddr: 2,
    mouseMoveYDeltaAddr: 3,
    mouseButtonStateAddr: 4,
    keyEventFlagAddr: 5,
    keyCodeAddr: 6,
    keyStateAddr: 7,
  };

  var LockStates = {
    READY_FOR_UI_THREAD: 0,
    UI_THREAD_LOCK: 1,
    READY_FOR_EMUL_THREAD: 2,
    EMUL_THREAD_LOCK: 3,
  };

  var audioContext = new AudioContext();

  var gainNode = audioContext.createGain();

  gainNode.gain.value = 1;
  gainNode.connect(audioContext.destination);

  var warningLastTime = {};
  var warningCount = {};
  function throttledWarning(message, type = '') {
    warningCount[type] = (warningCount[type] || 0) + 1;
    if (Date.now() - (warningLastTime[type] || 0) > 5000) {
      console.warn(message, `${warningCount[type] || 0} times`);
      warningLastTime[type] = Date.now();
      warningCount[type] = 0;
    }
  }

  function openAudio() {
    audio.pushAudio = function pushAudio(
      blockBuffer, // u8 typed array
      sizeBytes // probably (frames per block=4096) * (bytes per sample=2) * (n channels=1)
    ) {
      if (audio.paused) return;

      var sizeSamples = sizeBytes / audio.bytesPerSample; // How many samples fit in the callback buffer?
      var sizeSamplesPerChannel = sizeSamples / audio.channels; // How many samples per a single channel fit in the cb buffer?
      if (sizeSamplesPerChannel != audio.samples) {
        throw 'Received mismatching audio buffer size!';
      }
      // Allocate new sound buffer to be played.
      var source = audioContext.createBufferSource();
      var soundBuffer = audioContext.createBuffer(
        audio.channels,
        sizeSamplesPerChannel,
        audio.freq
      );
      // source.connect(audioContext.destination);
      source.connect(gainNode);

      audio.fillWebAudioBufferFromChunk(
        blockBuffer,
        sizeSamplesPerChannel,
        soundBuffer
      );
      // Workaround https://bugzilla.mozilla.org/show_bug.cgi?id=883675 by setting the buffer only after filling. The order is important here!
      source.buffer = soundBuffer;

      // Schedule the generated sample buffer to be played out at the correct time right after the previously scheduled
      // sample buffer has finished.
      var curtime = audioContext.currentTime;

      // assertion
      if (curtime > audio.nextPlayTime && audio.nextPlayTime != 0) {
        // console.log('warning: Audio callback had starved sending audio by ' + (curtime - audio.nextPlayTime) + ' seconds.');
      }

      // Don't ever start buffer playbacks earlier from current time than a given constant 'audio.bufferingDelay', since a browser
      // may not be able to mix that audio clip in immediately, and there may be subsequent jitter that might cause the stream to starve.
      var playtime = Math.max(curtime + audio.bufferingDelay, audio.nextPlayTime);
      source.start(playtime);
      // console.log(`queuing audio for ${playtime}`)

      audio.nextPlayTime = playtime + audio.bufferDurationSecs;
    };

    audio.getBlockBuffer = function getBlockBuffer() {
      // audio chunk layout
      // 0: lock state
      // 1: pointer to next chunk
      // 2 to (2+buffersize): audio buffer
      var curChunkIndex = audio.nextChunkIndex;
      var curChunkAddr = curChunkIndex * audioBlockChunkSize;

      if (audioDataBufferView[curChunkAddr] !== LockStates.UI_THREAD_LOCK) {
        if (audio.gotFirstBlock) {
          // throttledWarning('UI thread tried to read audio data from worker-locked chunk');
        }
        return null;
      }
      audio.gotFirstBlock = true;

      var blockBuffer = audioDataBufferView.slice(
        curChunkAddr + 2,
        curChunkAddr + 2 + audio.bufferSize
      );
      audio.nextChunkIndex = audioDataBufferView[curChunkAddr + 1];
      // console.assert(audio.nextChunkIndex != curChunkIndex, `curChunkIndex=${curChunkIndex} == nextChunkIndex=${audio.nextChunkIndex}`)
      audioDataBufferView[curChunkAddr] = LockStates.EMUL_THREAD_LOCK;
      return blockBuffer;
    };

    audio.fillWebAudioBufferFromChunk = function fillWebAudioBufferFromChunk(
      blockBuffer, // u8 typed array
      blockSize, // probably 4096
      dstAudioBuffer
    ) {
      for (var c = 0; c < audio.channels; ++c) {
        var channelData = dstAudioBuffer.getChannelData(c);
        if (channelData.length != blockSize) {
          throw 'Web Audio output buffer length mismatch! Destination size: ' +
            channelData.length +
            ' samples vs expected ' +
            blockSize +
            ' samples!';
        }
        var blockBufferI16 = new Int16Array(blockBuffer.buffer);

        for (var j = 0; j < blockSize; ++j) {
          channelData[j] = blockBufferI16[j] / 0x8000; // convert i16 to f32 in range -1 to +1
        }
      }
    };

    // Pulls and queues new audio data if appropriate. This function gets "over-called" in both requestAnimationFrames and
    // setTimeouts to ensure that we get the finest granularity possible and as many chances from the browser to fill
    // new audio data. This is because setTimeouts alone have very poor granularity for audio streaming purposes, but also
    // the application might not be using emscripten_set_main_loop to drive the main loop, so we cannot rely on that alone.
    audio.queueNewAudioData = function queueNewAudioData() {
      var i = 0;
      for (; i < audio.numSimultaneouslyQueuedBuffers; ++i) {
        // Only queue new data if we don't have enough audio data already in queue. Otherwise skip this time slot
        // and wait to queue more in the next time the callback is run.
        var secsUntilNextPlayStart =
          audio.nextPlayTime - audioContext.currentTime;
        if (
          secsUntilNextPlayStart >=
          audio.bufferingDelay +
            audio.bufferDurationSecs * audio.numSimultaneouslyQueuedBuffers
        )
          return;

        var blockBuffer = audio.getBlockBuffer();
        if (!blockBuffer) {
          return;
        }

        // And queue it to be played after the currently playing audio stream.
        audio.pushAudio(blockBuffer, audio.bufferSize);
      }
      // console.log(`queued ${i} buffers of audio`);
    };

    // Create a callback function that will be routinely called to ask more audio data from the user application.
    audio.caller = function audioCaller() {
      --audio.numAudioTimersPending;

      audio.queueNewAudioData();

      // Queue this callback function to be called again later to pull more audio data.
      var secsUntilNextPlayStart = audio.nextPlayTime - audioContext.currentTime;

      // Queue the next audio frame push to be performed half-way when the previously queued buffer has finished playing.
      var preemptBufferFeedSecs = audio.bufferDurationSecs / 2.0;

      if (audio.numAudioTimersPending < audio.numSimultaneouslyQueuedBuffers) {
        ++audio.numAudioTimersPending;
        audio.timer = setTimeout(
          audio.caller,
          Math.max(0.0, 1000.0 * (secsUntilNextPlayStart - preemptBufferFeedSecs))
        );

        // If we are risking starving, immediately queue an extra buffer.
        if (audio.numAudioTimersPending < audio.numSimultaneouslyQueuedBuffers) {
          ++audio.numAudioTimersPending;
          setTimeout(audio.caller, 1.0);
        }
      }
    };

    audio.numAudioTimersPending = 1;
    audio.timer = setTimeout(audio.caller, 1);
  }

  function acquireTwoStateLock(bufferView, lockIndex) {
    var res = Atomics.compareExchange(
      bufferView,
      lockIndex,
      LockStates.EMUL_THREAD_LOCK,
      LockStates.UI_THREAD_LOCK
    );
    if (res === LockStates.EMUL_THREAD_LOCK) {
      return true;
    }
    return false;
  }

  function releaseTwoStateLock(bufferView, lockIndex) {
    Atomics.store(bufferView, lockIndex, LockStates.EMUL_THREAD_LOCK); // unlock

    Atomics_notify(bufferView, lockIndex);
  }

  releaseTwoStateLock(videoModeBufferView, 9);

  function acquireLock(bufferView, lockIndex) {
    var res = Atomics.compareExchange(
      bufferView,
      lockIndex,
      LockStates.READY_FOR_UI_THREAD,
      LockStates.UI_THREAD_LOCK
    );
    if (res === LockStates.READY_FOR_UI_THREAD) {
      return true;
    }
    return false;
  }

  function releaseLock(bufferView, lockIndex) {
    Atomics.store(bufferView, lockIndex, LockStates.READY_FOR_EMUL_THREAD); // unlock

    Atomics_notify(bufferView, lockIndex);
  }

  function releaseInputLock() {
    releaseLock(inputBufferView, InputBufferAddresses.globalLockAddr);
  }
  function tryToSendInput() {
    if (!acquireLock(inputBufferView, InputBufferAddresses.globalLockAddr)) {
      return;
    }
    var hasMouseMove = false;
    var mouseMoveX = 0;
    var mouseMoveY = 0;
    var mouseButtonState = -1;
    var hasKeyEvent = false;
    var keyCode = -1;
    var keyState = -1;
    // currently only one key event can be sent per sync
    // TODO: better key handling code
    var remainingKeyEvents = [];
    for (var i = 0; i < inputQueue.length; i++) {
      var inputEvent = inputQueue[i];
      switch (inputEvent.type) {
        case 'mousemove':
          if (hasMouseMove) {
            break;
          }
          hasMouseMove = true;
          mouseMoveX += inputEvent.dx;
          mouseMoveY += inputEvent.dy;
          break;
        case 'mousedown':
        case 'mouseup':
          mouseButtonState = inputEvent.type === 'mousedown' ? 1 : 0;
          break;
        case 'keydown':
        case 'keyup':
          if (hasKeyEvent) {
            remainingKeyEvents.push(inputEvent);
            break;
          }
          hasKeyEvent = true;
          keyState = inputEvent.type === 'keydown' ? 1 : 0;
          keyCode = inputEvent.keyCode;
          break;
      }
    }
    if (hasMouseMove) {
      inputBufferView[InputBufferAddresses.mouseMoveFlagAddr] = 1;
      inputBufferView[InputBufferAddresses.mouseMoveXDeltaAddr] = mouseMoveX;
      inputBufferView[InputBufferAddresses.mouseMoveYDeltaAddr] = mouseMoveY;
    }
    inputBufferView[InputBufferAddresses.mouseButtonStateAddr] = mouseButtonState;
    if (hasKeyEvent) {
      inputBufferView[InputBufferAddresses.keyEventFlagAddr] = 1;
      inputBufferView[InputBufferAddresses.keyCodeAddr] = keyCode;
      inputBufferView[InputBufferAddresses.keyStateAddr] = keyState;
    }
    releaseInputLock();
    inputQueue = remainingKeyEvents;
  }
  canvas.addEventListener('mousemove', function(event) {
    inputQueue.push({type: 'mousemove', dx: event.offsetX, dy: event.offsetY});
  });
  canvas.addEventListener('mousedown', function(event) {
    inputQueue.push({type: 'mousedown'});
  });
  canvas.addEventListener('mouseup', function(event) {
    inputQueue.push({type: 'mouseup'});
  });
  window.addEventListener('keydown', function(event) {
    inputQueue.push({type: 'keydown', keyCode: event.keyCode});
  });
  window.addEventListener('keyup', function(event) {
    inputQueue.push({type: 'keyup', keyCode: event.keyCode});
  });

  if (!window.location.hash) {
    window.location.hash = "#1996/geocities.com/";
  }

  var workerConfig = {
    inputBuffer: inputBuffer,
    inputBufferSize: INPUT_BUFFER_SIZE,
    screenBuffer: screenBuffer,
    screenBufferSize: SCREEN_BUFFER_SIZE,
    videoModeBuffer: videoModeBuffer,
    videoModeBufferSize: VIDEO_MODE_BUFFER_SIZE,
    audioDataBuffer: audioDataBuffer,
    audioDataBufferSize: AUDIO_DATA_BUFFER_SIZE,
    audioBlockBufferSize: audio.bufferSize,
    audioBlockChunkSize: audioBlockChunkSize,
    screenWidth: SCREEN_WIDTH,
    screenHeight: SCREEN_HEIGHT,
    config: config,
  };

  //if (singleThreadedEmscripten) {
  var worker = new Worker('dist/bas-worker.js');

  worker.postMessage(workerConfig);

  worker.addEventListener("message", (event) => {
    if (progressTarget) {
      progressTarget.dispatchEvent(new CustomEvent("dl-progress", {detail: event.data}));
    }
  });
  //}

  function drawScreen() {
    const pixelsRGBA = imageData.data;
    const numPixels = SCREEN_WIDTH * SCREEN_HEIGHT;
    const expandedFromPalettedMode = videoModeBufferView[3];
    const start = audioContext.currentTime;
    // if (!acquireTwoStateLock(videoModeBufferView, 9)) {
    //   console.log('skipped frame in client');
    //   return;
    // }
    // while (acquireTwoStateLock(videoModeBufferView, 9)) {
    //   if (audioContext.currentTime - start > 0.1666666) {
    //     console.warn('failed to acquire video lock, dropping frame');
    //     return;
    //   }
    // }
    if (expandedFromPalettedMode) {
      for (var i = 0; i < numPixels; i++) {
        // palette
        pixelsRGBA[i * 4 + 0] = screenBufferView[i * 4 + 0];
        pixelsRGBA[i * 4 + 1] = screenBufferView[i * 4 + 1];
        pixelsRGBA[i * 4 + 2] = screenBufferView[i * 4 + 2];
        pixelsRGBA[i * 4 + 3] = 255; // full opacity
      }
    } else {
      for (var i = 0; i < numPixels; i++) {
        // ARGB
        pixelsRGBA[i * 4 + 0] = screenBufferView[i * 4 + 1];
        pixelsRGBA[i * 4 + 1] = screenBufferView[i * 4 + 2];
        pixelsRGBA[i * 4 + 2] = screenBufferView[i * 4 + 3];
        pixelsRGBA[i * 4 + 3] = 255; // full opacity
      }
    }

    // releaseTwoStateLock(videoModeBufferView, 9);

    canvasCtx.putImageData(imageData, 0, 0);
  }

  function asyncLoop() {
    drawScreen();
    tryToSendInput();
    requestAnimationFrame(asyncLoop);
  }

  openAudio();
  asyncLoop();
}
