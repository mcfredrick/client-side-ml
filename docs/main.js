(() => {
  // src/main.js
  var dropZone = document.getElementById("drop-zone");
  var fileInput = document.getElementById("file-input");
  var statusEl = document.getElementById("status");
  var progressContainer = document.getElementById("progress-bar-container");
  var progressBar = document.getElementById("progress-bar");
  var stemsEl = document.getElementById("stems");
  var audioCtx = null;
  console.log("[main] Creating worker...");
  var worker = new Worker("./worker.js");
  worker.onerror = (e) => {
    console.error("[main] Worker error:", e.message, e);
    setStatus(`Worker failed to load: ${e.message}`);
  };
  console.log("[main] Worker created, ready for input.");
  function setStatus(text) {
    console.log("[main] Status:", text);
    statusEl.textContent = text;
  }
  function showProgress(fraction) {
    progressContainer.style.display = "block";
    progressBar.style.width = `${(fraction * 100).toFixed(1)}%`;
  }
  function hideProgress() {
    progressContainer.style.display = "none";
    progressBar.style.width = "0%";
  }
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });
  async function handleFile(file) {
    console.log("[main] File selected:", file.name, `(${(file.size / 1024 / 1024).toFixed(1)} MB, type: ${file.type})`);
    setStatus(`Decoding "${file.name}"...`);
    stemsEl.style.display = "none";
    stemsEl.innerHTML = "";
    hideProgress();
    try {
      if (!audioCtx) {
        audioCtx = new AudioContext({ sampleRate: 44100 });
        console.log("[main] AudioContext created (sampleRate:", audioCtx.sampleRate + ")");
      }
      if (audioCtx.state === "suspended") {
        console.log("[main] Resuming suspended AudioContext...");
        await audioCtx.resume();
      }
      const arrayBuffer = await file.arrayBuffer();
      console.log("[main] File read into ArrayBuffer, decoding audio...");
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      console.log("[main] Audio decoded:", {
        channels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        duration: `${audioBuffer.duration.toFixed(1)}s`,
        samples: audioBuffer.length
      });
      const channelData = [];
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        channelData.push(audioBuffer.getChannelData(ch));
      }
      if (channelData.length === 1) {
        console.log("[main] Mono audio \u2014 duplicating to stereo");
        channelData.push(new Float32Array(channelData[0]));
      }
      const rawAudio = {
        channelData,
        sampleRate: audioBuffer.sampleRate
      };
      console.log("[main] Sending audio to worker...");
      worker.postMessage(
        { type: "separate", rawAudio },
        rawAudio.channelData.map((c) => c.buffer)
      );
      console.log("[main] Audio sent to worker (buffers transferred).");
    } catch (err) {
      console.error("[main] Error:", err);
      setStatus(`Error decoding audio: ${err.message}`);
    }
  }
  worker.onmessage = (e) => {
    const msg = e.data;
    console.log("[main] Worker message:", msg.type, msg.type === "progress" ? `${msg.step}/${msg.total}` : "");
    if (msg.type === "status") {
      setStatus(msg.text);
    }
    if (msg.type === "progress") {
      setStatus(`Separating stems... (${msg.step}/${msg.total})`);
      showProgress(msg.step / msg.total);
    }
    if (msg.type === "done") {
      hideProgress();
      setStatus("Done! Listen to the separated stems below.");
      stemsEl.style.display = "block";
      console.log("[main] Stems received:", Object.keys(msg.tracks));
      for (const [name, wavBuffer] of Object.entries(msg.tracks)) {
        const blob = new Blob([wavBuffer], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const div = document.createElement("div");
        div.className = "stem";
        const label = document.createElement("label");
        label.textContent = name;
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = url;
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name}.wav`;
        link.textContent = "Download";
        div.appendChild(label);
        div.appendChild(audio);
        div.appendChild(link);
        stemsEl.appendChild(div);
      }
    }
    if (msg.type === "error") {
      hideProgress();
      console.error("[main] Worker error:", msg.message);
      setStatus(`Error: ${msg.message}`);
    }
  };
})();
