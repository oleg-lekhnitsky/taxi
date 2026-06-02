const courses = [
  { note: "C", octave: 2, frequency: 65.41 },
  { note: "F", octave: 2, frequency: 87.31 },
  { note: "A", octave: 2, frequency: 110.0 },
  { note: "D", octave: 3, frequency: 146.83 },
  { note: "G", octave: 3, frequency: 196.0 },
  { note: "C", octave: 4, frequency: 261.63 },
];

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const elements = {
  button: document.querySelector("#listenButton"),
  label: document.querySelector("#listenLabel"),
  note: document.querySelector("#noteName"),
  flat: document.querySelector("#flatLabel"),
  octave: document.querySelector("#octave"),
  frequency: document.querySelector("#frequency"),
  cents: document.querySelector("#cents"),
  detected: document.querySelector("#detectedLabel"),
  needle: document.querySelector("#needle"),
  grid: document.querySelector("#courseGrid"),
};

let audioContext;
let analyser;
let stream;
let frameId;
let lastPitch = 0;

function renderCourses(activeIndex = -1) {
  elements.grid.innerHTML = courses.map((course, index) => `
    <div class="course ${index === activeIndex ? "active" : ""}">
      <strong>${course.note}<sup>${course.octave}</sup></strong>
      <small>${course.frequency.toFixed(course.frequency < 100 ? 1 : 0)} Hz</small>
    </div>
  `).join("");
}

function nearestCourse(frequency) {
  return courses.reduce((best, course, index) => {
    const distance = Math.abs(1200 * Math.log2(frequency / course.frequency));
    return distance < best.distance ? { course, index, distance } : best;
  }, { course: courses[0], index: 0, distance: Infinity });
}

function noteFromFrequency(frequency) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const name = NOTE_NAMES[(midi % 12 + 12) % 12];
  return { name, octave: Math.floor(midi / 12) - 1 };
}

function autoCorrelate(buffer, sampleRate) {
  let rms = 0;
  for (const value of buffer) rms += value * value;
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.002) return -1;

  const minSamples = Math.floor(sampleRate / 350);
  const maxSamples = Math.min(Math.floor(sampleRate / 50), buffer.length / 2);
  const difference = new Float32Array(maxSamples + 1);
  const normalized = new Float32Array(maxSamples + 1);

  for (let offset = 1; offset <= maxSamples; offset++) {
    let sum = 0;
    for (let i = 0; i < buffer.length - offset; i++) {
      const delta = buffer[i] - buffer[i + offset];
      sum += delta * delta;
    }
    difference[offset] = sum;
  }

  let runningSum = 0;
  normalized[0] = 1;
  for (let offset = 1; offset <= maxSamples; offset++) {
    runningSum += difference[offset];
    normalized[offset] = runningSum ? difference[offset] * offset / runningSum : 1;
  }

  let bestOffset = -1;
  for (let offset = minSamples; offset < maxSamples; offset++) {
    if (normalized[offset] < 0.18) {
      while (offset + 1 < maxSamples && normalized[offset + 1] < normalized[offset]) offset++;
      bestOffset = offset;
      break;
    }
  }

  if (bestOffset < 0) return -1;
  const left = normalized[bestOffset - 1];
  const center = normalized[bestOffset];
  const right = normalized[bestOffset + 1];
  const divisor = 2 * (2 * center - right - left);
  const refinedOffset = divisor ? bestOffset + (right - left) / divisor : bestOffset;
  return sampleRate / refinedOffset;
}

function updateDisplay(rawPitch) {
  const octaveJump = lastPitch && Math.abs(1200 * Math.log2(rawPitch / lastPitch)) > 700;
  lastPitch = lastPitch && !octaveJump ? lastPitch * .72 + rawPitch * .28 : rawPitch;
  const pitch = lastPitch;
  const { course, index } = nearestCourse(pitch);
  const cents = Math.round(1200 * Math.log2(pitch / course.frequency));
  const displayNote = noteFromFrequency(pitch);
  const noteParts = displayNote.name.split(/(?=[♯♭])/);

  elements.note.textContent = noteParts[0];
  elements.flat.textContent = noteParts[1] || "";
  elements.octave.textContent = displayNote.octave;
  elements.frequency.textContent = pitch.toFixed(1);
  elements.needle.style.transform = `rotate(${Math.max(-42, Math.min(42, cents * .84))}deg)`;
  elements.needle.style.opacity = "1";
  if (elements.detected) elements.detected.textContent = `Target ${course.note}${course.octave}`;
  renderCourses(index);

  if (Math.abs(cents) <= 4) {
    if (elements.cents) elements.cents.textContent = "In tune";
  } else if (cents < 0) {
    if (elements.cents) elements.cents.textContent = `${Math.abs(cents)} cents flat · tune up`;
  } else {
    if (elements.cents) elements.cents.textContent = `${cents} cents sharp · tune down`;
  }
}

function listen() {
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  const pitch = autoCorrelate(samples, audioContext.sampleRate);
  if (pitch > 0) updateDisplay(pitch);
  frameId = requestAnimationFrame(listen);
}

async function startTuning() {
  if (stream) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 4096;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    document.body.classList.add("listening");
    elements.label.textContent = "Listening";
    if (elements.detected) elements.detected.textContent = "Play one course";
    listen();
  } catch (error) {
    if (elements.detected) elements.detected.textContent = "Microphone unavailable";
    if (elements.cents) elements.cents.textContent = "Allow microphone access and try again";
  }
}

function stopTuning() {
  cancelAnimationFrame(frameId);
  stream?.getTracks().forEach(track => track.stop());
  audioContext?.close();
  stream = null;
  audioContext = null;
  lastPitch = 0;
  document.body.classList.remove("listening");
  elements.label.textContent = "Start tuning";
  if (elements.detected) elements.detected.textContent = "Ready to listen";
  if (elements.cents) elements.cents.textContent = "Tune the lowest course to begin";
  elements.needle.style.opacity = ".4";
  elements.needle.style.transform = "rotate(0deg)";
  renderCourses();
}

elements.button.addEventListener("click", () => stream ? stopTuning() : startTuning());

async function autoStartTuning() {
  try {
    const permission = await navigator.permissions?.query({ name: "microphone" });
    if (permission?.state === "granted") await startTuning();
  } catch {
    // Some mobile browsers do not expose microphone permission queries.
  }
}

if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
  document.querySelector("#installHint").hidden = true;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  });
}

renderCourses();
autoStartTuning();
