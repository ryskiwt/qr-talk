(() => {
  "use strict";

  const PEER_OPTIONS = {
    debug: 1,
    config: {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      sdpSemantics: "unified-plan",
    },
  };

  const PEER_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;
  const QR_VERSION = 5;
  const QR_SIZE = QR_VERSION * 4 + 17;
  const QR_DATA_CODEWORDS = 108;
  const QR_ECC_CODEWORDS = 26;
  const QR_BYTE_CAPACITY = 106;
  const SCAN_INTERVAL_MS = 180;
  const HEARTBEAT_INTERVAL_MS = 4000;
  const PARTICIPANT_TIMEOUT_MS = 14000;
  const UNLOCK_HOLD_MS = 1200;

  const $ = (selector) => document.querySelector(selector);

  const els = {
    homeView: $("#homeView"),
    directJoinView: $("#directJoinView"),
    scannerView: $("#scannerView"),
    roomView: $("#roomView"),
    startTalkButton: $("#startTalkButton"),
    joinTalkButton: $("#joinTalkButton"),
    directJoinButton: $("#directJoinButton"),
    directBackButton: $("#directBackButton"),
    scannerStatus: $("#scannerStatus"),
    cancelScanButton: $("#cancelScanButton"),
    scannerVideo: $("#scannerVideo"),
    scannerCanvas: $("#scannerCanvas"),
    roomTitle: $("#roomTitle"),
    roomQrCanvas: $("#roomQrCanvas"),
    roomUrlText: $("#roomUrlText"),
    copyLinkButton: $("#copyLinkButton"),
    muteButton: $("#muteButton"),
    muteButtonText: $("#muteButtonText"),
    muteSlash: $("#muteSlash"),
    pocketLockButton: $("#pocketLockButton"),
    leaveButton: $("#leaveButton"),
    audioInputSelect: $("#audioInputSelect"),
    audioOutputSelect: $("#audioOutputSelect"),
    audioUnlockButton: $("#audioUnlockButton"),
    participantsList: $("#participantsList"),
    remoteAudioMount: $("#remoteAudioMount"),
    pocketOverlay: $("#pocketOverlay"),
    unlockHoldButton: $("#unlockHoldButton"),
    toast: $("#toast"),
  };

  const state = {
    mode: "home",
    role: null,
    roomId: null,
    hostId: null,
    peerId: null,
    pendingRoomId: null,
    peer: null,
    localStream: null,
    scannerStream: null,
    scanTimer: null,
    barcodeDetector: null,
    hostConnection: null,
    dataConnections: new Map(),
    mediaConnections: new Map(),
    remoteAudios: new Map(),
    participants: new Map(),
    presenceTimer: null,
    isLeaving: false,
    suppressHostCloseNotice: false,
    muted: false,
    preferredInputId: "",
    preferredOutputId: "",
    wakeLock: null,
    wakeWanted: false,
    unlockTimer: null,
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindEvents();
    updateMuteButton();
    const roomId = extractRoomId(window.location.href);
    if (roomId) {
      state.pendingRoomId = roomId;
      showView("directJoin");
    } else {
      showView("home");
    }
    updateConnectionBadge("待機中");
    updateDeviceSupportUI();
  }

  function bindEvents() {
    els.startTalkButton.addEventListener("click", () => startRoom().catch(handleFatalError));
    els.joinTalkButton.addEventListener("click", () => startScanner().catch(handleFatalError));
    els.directJoinButton.addEventListener("click", () => {
      if (state.pendingRoomId) {
        joinRoom(state.pendingRoomId).catch(handleFatalError);
      }
    });
    els.directBackButton.addEventListener("click", () => {
      state.pendingRoomId = null;
      clearRoomUrl();
      showView("home");
    });
    els.cancelScanButton.addEventListener("click", () => {
      stopScanner();
      showView("home");
    });
    els.leaveButton.addEventListener("click", () => leaveRoom("退出しました。").catch(handleFatalError));
    els.muteButton.addEventListener("click", toggleMute);
    els.pocketLockButton.addEventListener("click", enablePocketLock);
    els.copyLinkButton.addEventListener("click", copyRoomLink);
    els.audioInputSelect.addEventListener("change", onInputDeviceChange);
    els.audioOutputSelect.addEventListener("change", onOutputDeviceChange);
    els.audioUnlockButton.addEventListener("click", unlockRemoteAudio);
    els.unlockHoldButton.addEventListener("pointerdown", beginUnlockHold);
    els.unlockHoldButton.addEventListener("pointerup", cancelUnlockHold);
    els.unlockHoldButton.addEventListener("pointercancel", cancelUnlockHold);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", notifyLeaveBeforeUnload);

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", () => {
        populateDevices().catch(() => undefined);
      });
    }
  }

  async function startRoom() {
    await enterRoom({ role: "host" });
  }

  async function joinRoom(roomId) {
    if (!isValidPeerId(roomId)) {
      throw new Error("QRコードのルームIDを読み取れませんでした。");
    }
    await enterRoom({ role: "guest", roomId });
  }

  async function enterRoom({ role, roomId = null }) {
    assertRequiredBrowserFeatures();
    setBusy(true);
    updateConnectionBadge("準備中");
    stopScanner();

    try {
      state.localStream = await getAudioStream();
      await populateDevices();

      state.role = role;
      state.peer = createPeer();
      bindPeerEvents(state.peer);

      const peerId = await waitForPeerOpen(state.peer);
      state.peerId = peerId;
      state.hostId = role === "host" ? peerId : roomId;
      state.roomId = state.hostId;
      state.participants.set(peerId, {
        label: "自分",
        state: "自分",
      });

      showRoom();
      renderParticipants();
      await renderRoomQr();
      setRoomUrl(state.roomId);
      startPresenceMonitor();
      await requestWakeLock();

      if (role === "guest") {
        connectToHost();
      } else {
        updateConnectionBadge("接続中");
        updateRoomStatus();
      }
    } finally {
      setBusy(false);
    }
  }

  function createPeer() {
    if (typeof window.Peer !== "function") {
      throw new Error("PeerJSを読み込めませんでした。ネットワーク接続を確認してください。");
    }
    return new window.Peer(undefined, PEER_OPTIONS);
  }

  function bindPeerEvents(peer) {
    peer.on("call", (call) => handleIncomingCall(call));
    peer.on("connection", (connection) => handleIncomingDataConnection(connection));
    peer.on("disconnected", () => updateConnectionBadge("シグナリング切断"));
    peer.on("close", () => updateConnectionBadge("切断"));
    peer.on("error", (error) => handlePeerError(error));
  }

  function waitForPeerOpen(peer) {
    return new Promise((resolve, reject) => {
      peer.once("open", resolve);
      peer.once("error", reject);
    });
  }

  async function getAudioStream() {
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (state.preferredInputId) {
      audio.deviceId = { exact: state.preferredInputId };
    }

    return navigator.mediaDevices.getUserMedia({ audio, video: false });
  }

  function connectToHost() {
    if (!state.peer || !state.hostId || state.hostId === state.peerId) {
      throw new Error("参加先のルームが正しくありません。");
    }

    if (state.hostConnection?.peer === state.hostId && state.hostConnection.open) {
      return;
    }

    if (state.hostConnection) {
      state.suppressHostCloseNotice = true;
      state.hostConnection.close();
      state.hostConnection = null;
    }

    setRoomStatus("ルームへ接続中");
    const connection = state.peer.connect(state.hostId, {
      reliable: true,
      metadata: { role: "guest", peerId: state.peerId },
    });

    state.hostConnection = connection;
    connection.on("open", () => {
      sendData(connection, { type: "join", peerId: state.peerId });
      updateConnectionBadge("接続中");
    });
    connection.on("data", (message) => handleHostMessage(message));
    connection.on("close", () => {
      if (state.isLeaving) {
        return;
      }
      if (state.mode === "room") {
        const closedPeerId = connection.peer;
        const shouldNotify = !state.suppressHostCloseNotice;
        if (state.hostConnection === connection) {
          state.hostConnection = null;
        }
        removeParticipant(closedPeerId, { broadcast: false });
        if (state.hostId === closedPeerId || !state.hostId) {
          electRoomCoordinator();
        }
        if (shouldNotify && state.participants.size > 0) {
          showToast("参加受付が切断されたため、参加用QRを更新しました。");
        }
      }
      state.suppressHostCloseNotice = false;
    });
    connection.on("error", () => showToast("ルームへの接続に失敗しました。"));
  }

  function handleIncomingDataConnection(connection) {
    if (state.role !== "host") {
      connection.close();
      return;
    }

    const remotePeerId = connection.peer;
    state.dataConnections.set(remotePeerId, connection);

    connection.on("data", (message) => {
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "join") {
        acceptParticipant(connection);
      }
      if (message.type === "leave") {
        removeParticipant(remotePeerId, { broadcast: true });
      }
      if (message.type === "heartbeat") {
        touchParticipant(remotePeerId, "接続中");
      }
    });
    connection.on("close", () => {
      if (!state.isLeaving) {
        removeParticipant(remotePeerId, { broadcast: true });
      }
    });
    connection.on("error", () => {
      if (!state.isLeaving) {
        removeParticipant(remotePeerId, { broadcast: true });
      }
    });
  }

  function acceptParticipant(connection) {
    const remotePeerId = connection.peer;
    const existingPeers = [...state.participants.keys()].filter((peerId) => peerId !== remotePeerId);

    state.participants.set(remotePeerId, {
      label: shortId(remotePeerId),
      state: "接続中",
      lastSeen: Date.now(),
    });

    sendData(connection, {
      type: "room-state",
      roomId: state.roomId,
      hostId: state.peerId,
      peers: existingPeers,
    });
    broadcastHostMessage({ type: "peer-joined", peerId: remotePeerId }, remotePeerId);
    broadcastRoster();
    updateRoomStatus();
    renderParticipants();
  }

  function handleHostMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "room-state") {
      state.roomId = message.roomId;
      state.hostId = message.hostId;
      const peerIds = Array.isArray(message.peers) ? message.peers : [];
      peerIds
        .filter((peerId) => peerId !== state.peerId)
        .forEach((peerId) => {
          addParticipant(peerId, "接続中");
          callPeer(peerId);
        });
      updateRoomStatus();
      renderParticipants();
      renderRoomQr().catch(() => undefined);
    }

    if (message.type === "peer-joined" && message.peerId !== state.peerId) {
      addParticipant(message.peerId, "接続中");
      updateRoomStatus();
      renderParticipants();
    }

    if (message.type === "peer-left") {
      handlePeerLeft(message.peerId);
    }

    if (message.type === "roster") {
      applyRoster(message);
    }

    if (message.type === "room-closed") {
      handlePeerLeft(state.hostId);
    }
  }

  function handleIncomingCall(call) {
    if (!state.localStream) {
      call.close();
      return;
    }

    addParticipant(call.peer, "接続中");
    registerMediaConnection(call);
    call.answer(state.localStream);
    renderParticipants();
  }

  function callPeer(peerId) {
    if (!state.peer || !state.localStream || peerId === state.peerId || state.mediaConnections.has(peerId)) {
      return;
    }

    const call = state.peer.call(peerId, state.localStream, {
      metadata: { roomId: state.roomId, peerId: state.peerId },
    });
    addParticipant(peerId, "接続中");
    registerMediaConnection(call);
  }

  function registerMediaConnection(call) {
    const peerId = call.peer;
    const existing = state.mediaConnections.get(peerId);
    if (existing && existing !== call) {
      existing.close();
    }

    state.mediaConnections.set(peerId, call);

    call.on("stream", (stream) => {
      attachRemoteAudio(peerId, stream);
      setParticipantState(peerId, "接続済み");
    });
    call.on("close", () => {
      if (state.mediaConnections.get(peerId) === call) {
      state.mediaConnections.delete(peerId);
      detachRemoteAudio(peerId);
      setParticipantState(peerId, "未接続");
    }
    });
    call.on("error", () => setParticipantState(peerId, "接続エラー"));
  }

  async function attachRemoteAudio(peerId, stream) {
    detachRemoteAudio(peerId);

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = stream;
    audio.dataset.peerId = peerId;
    els.remoteAudioMount.append(audio);
    state.remoteAudios.set(peerId, audio);
    await applyOutputDevice(audio);

    try {
      await audio.play();
      els.audioUnlockButton.classList.add("hidden");
    } catch {
      els.audioUnlockButton.classList.remove("hidden");
      showToast("ブラウザが自動再生を止めています。音声を再生を押してください。");
    }

    renderParticipants();
  }

  function detachRemoteAudio(peerId) {
    const audio = state.remoteAudios.get(peerId);
    if (!audio) {
      return;
    }
    audio.srcObject = null;
    audio.remove();
    state.remoteAudios.delete(peerId);
  }

  async function startScanner() {
    assertRequiredBrowserFeatures();
    setBusy(true);
    showView("scanner");
    els.scannerStatus.textContent = "カメラを起動しています。";

    try {
      state.scannerStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      els.scannerVideo.srcObject = state.scannerStream;
      await els.scannerVideo.play();
      await setupBarcodeDetector();
      els.scannerStatus.textContent = "QRコードを枠内に入れてください。";
      scanQrLoop();
    } finally {
      setBusy(false);
    }
  }

  async function setupBarcodeDetector() {
    state.barcodeDetector = null;
    if ("BarcodeDetector" in window) {
      const formats = await window.BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes("qr_code")) {
        state.barcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
      }
    }
  }

  async function scanQrLoop() {
    if (state.mode !== "scanner" || !state.scannerStream) {
      return;
    }

    const value = await readQrFromVideo().catch(() => "");
    const roomId = value ? extractRoomId(value) : "";
    if (roomId) {
      stopScanner();
      await joinRoom(roomId);
      return;
    }

    state.scanTimer = window.setTimeout(scanQrLoop, SCAN_INTERVAL_MS);
  }

  async function readQrFromVideo() {
    const video = els.scannerVideo;
    if (!video.videoWidth || !video.videoHeight) {
      return "";
    }

    if (state.barcodeDetector) {
      const codes = await state.barcodeDetector.detect(video);
      return codes[0]?.rawValue || "";
    }

    if (typeof window.jsQR !== "function") {
      els.scannerStatus.textContent = "QR読み取りライブラリを読み込めませんでした。";
      return "";
    }

    const canvas = els.scannerCanvas;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const width = video.videoWidth;
    const height = video.videoHeight;
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const code = window.jsQR(imageData.data, width, height);
    return code?.data || "";
  }

  function stopScanner() {
    if (state.scanTimer) {
      window.clearTimeout(state.scanTimer);
      state.scanTimer = null;
    }
    if (state.scannerStream) {
      state.scannerStream.getTracks().forEach((track) => track.stop());
      state.scannerStream = null;
    }
    els.scannerVideo.srcObject = null;
  }

  async function renderRoomQr() {
    const roomUrl = buildRoomUrl(state.roomId);
    const qrPayload = getQrPayload(roomUrl, state.roomId);
    els.roomUrlText.textContent = roomUrl;
    drawLocalQr(els.roomQrCanvas, qrPayload);
  }

  function getQrPayload(roomUrl, roomId) {
    return byteLength(roomUrl) <= QR_BYTE_CAPACITY ? roomUrl : roomId;
  }

  function byteLength(text) {
    return new TextEncoder().encode(text).length;
  }

  function drawLocalQr(canvas, text) {
    const qr = createQrMatrix(text);
    const context = canvas.getContext("2d");
    const border = 4;
    const moduleCount = qr.length + border * 2;
    const scale = Math.floor(Math.min(canvas.width, canvas.height) / moduleCount);
    const drawnSize = moduleCount * scale;
    const offsetX = Math.floor((canvas.width - drawnSize) / 2);
    const offsetY = Math.floor((canvas.height - drawnSize) / 2);

    context.fillStyle = "#eef2f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#121820";

    qr.forEach((row, y) => {
      row.forEach((isDark, x) => {
        if (isDark) {
          context.fillRect(offsetX + (x + border) * scale, offsetY + (y + border) * scale, scale, scale);
        }
      });
    });
  }

  function createQrMatrix(text) {
    const data = encodeQrData(text);
    const ecc = createReedSolomonRemainder(data, QR_ECC_CODEWORDS);
    const codewords = [...data, ...ecc];
    const matrix = createEmptyMatrix(QR_SIZE);
    const reserved = createEmptyMatrix(QR_SIZE, false);

    drawQrFunctionPatterns(matrix, reserved);
    drawQrCodewords(matrix, reserved, codewords);
    applyQrMask(matrix, reserved, 0);
    drawQrFormatBits(matrix, reserved, 0);
    return matrix;
  }

  function encodeQrData(text) {
    const bytes = [...new TextEncoder().encode(text)];
    if (bytes.length > QR_BYTE_CAPACITY) {
      throw new Error("QRコードに入れる文字列が長すぎます。");
    }

    const bits = [];
    appendBits(bits, 0b0100, 4);
    appendBits(bits, bytes.length, 8);
    bytes.forEach((byte) => appendBits(bits, byte, 8));

    const capacityBits = QR_DATA_CODEWORDS * 8;
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8 !== 0) {
      bits.push(0);
    }

    const data = [];
    for (let index = 0; index < bits.length; index += 8) {
      data.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
    }

    for (let pad = 0; data.length < QR_DATA_CODEWORDS; pad += 1) {
      data.push(pad % 2 === 0 ? 0xec : 0x11);
    }

    return data;
  }

  function appendBits(bits, value, length) {
    for (let bit = length - 1; bit >= 0; bit -= 1) {
      bits.push((value >>> bit) & 1);
    }
  }

  function createEmptyMatrix(size, value = null) {
    return Array.from({ length: size }, () => Array.from({ length: size }, () => value));
  }

  function drawQrFunctionPatterns(matrix, reserved) {
    drawFinderPattern(matrix, reserved, 0, 0);
    drawFinderPattern(matrix, reserved, QR_SIZE - 7, 0);
    drawFinderPattern(matrix, reserved, 0, QR_SIZE - 7);
    drawAlignmentPattern(matrix, reserved, 30, 30);

    for (let index = 8; index < QR_SIZE - 8; index += 1) {
      setQrFunctionModule(matrix, reserved, index, 6, index % 2 === 0);
      setQrFunctionModule(matrix, reserved, 6, index, index % 2 === 0);
    }

    setQrFunctionModule(matrix, reserved, 8, QR_VERSION * 4 + 9, true);
    reserveFormatModules(reserved);
  }

  function drawFinderPattern(matrix, reserved, left, top) {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = left + x;
        const yy = top + y;
        if (!isInQrMatrix(xx, yy)) {
          continue;
        }

        const isFinder = x >= 0
          && x <= 6
          && y >= 0
          && y <= 6
          && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        setQrFunctionModule(matrix, reserved, xx, yy, isFinder);
      }
    }
  }

  function drawAlignmentPattern(matrix, reserved, centerX, centerY) {
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        const distance = Math.max(Math.abs(x), Math.abs(y));
        setQrFunctionModule(matrix, reserved, centerX + x, centerY + y, distance !== 1);
      }
    }
  }

  function reserveFormatModules(reserved) {
    for (let index = 0; index <= 5; index += 1) {
      reserved[index][8] = true;
      reserved[8][index] = true;
    }

    reserved[7][8] = true;
    reserved[8][8] = true;
    reserved[8][7] = true;

    for (let index = 9; index <= 14; index += 1) {
      reserved[8][14 - index] = true;
    }

    for (let index = 0; index <= 7; index += 1) {
      reserved[8][QR_SIZE - 1 - index] = true;
    }

    for (let index = 8; index <= 14; index += 1) {
      reserved[QR_SIZE - 15 + index][8] = true;
    }
  }

  function drawQrCodewords(matrix, reserved, codewords) {
    const bits = [];
    codewords.forEach((codeword) => appendBits(bits, codeword, 8));

    let bitIndex = 0;
    let upward = true;

    for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right -= 1;
      }

      for (let offset = 0; offset < QR_SIZE; offset += 1) {
        const y = upward ? QR_SIZE - 1 - offset : offset;
        for (let column = 0; column < 2; column += 1) {
          const x = right - column;
          if (!reserved[y][x]) {
            matrix[y][x] = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
            bitIndex += 1;
          }
        }
      }

      upward = !upward;
    }
  }

  function applyQrMask(matrix, reserved, mask) {
    for (let y = 0; y < QR_SIZE; y += 1) {
      for (let x = 0; x < QR_SIZE; x += 1) {
        if (!reserved[y][x] && shouldMaskQrModule(mask, x, y)) {
          matrix[y][x] = !matrix[y][x];
        }
      }
    }
  }

  function shouldMaskQrModule(mask, x, y) {
    if (mask === 0) {
      return (x + y) % 2 === 0;
    }
    return false;
  }

  function drawQrFormatBits(matrix, reserved, mask) {
    const bits = createQrFormatBits(mask);

    for (let index = 0; index <= 5; index += 1) {
      setQrFunctionModule(matrix, reserved, 8, index, getBit(bits, index));
    }
    setQrFunctionModule(matrix, reserved, 8, 7, getBit(bits, 6));
    setQrFunctionModule(matrix, reserved, 8, 8, getBit(bits, 7));
    setQrFunctionModule(matrix, reserved, 7, 8, getBit(bits, 8));

    for (let index = 9; index <= 14; index += 1) {
      setQrFunctionModule(matrix, reserved, 14 - index, 8, getBit(bits, index));
    }

    for (let index = 0; index <= 7; index += 1) {
      setQrFunctionModule(matrix, reserved, QR_SIZE - 1 - index, 8, getBit(bits, index));
    }

    for (let index = 8; index <= 14; index += 1) {
      setQrFunctionModule(matrix, reserved, 8, QR_SIZE - 15 + index, getBit(bits, index));
    }
  }

  function createQrFormatBits(mask) {
    const errorCorrectionLevelL = 1;
    const data = (errorCorrectionLevelL << 3) | mask;
    let remainder = data << 10;

    for (let bit = 14; bit >= 10; bit -= 1) {
      if (((remainder >>> bit) & 1) !== 0) {
        remainder ^= 0x537 << (bit - 10);
      }
    }

    return ((data << 10) | remainder) ^ 0x5412;
  }

  function setQrFunctionModule(matrix, reserved, x, y, isDark) {
    if (!isInQrMatrix(x, y)) {
      return;
    }
    matrix[y][x] = isDark;
    reserved[y][x] = true;
  }

  function isInQrMatrix(x, y) {
    return x >= 0 && x < QR_SIZE && y >= 0 && y < QR_SIZE;
  }

  function getBit(value, index) {
    return ((value >>> index) & 1) !== 0;
  }

  function createReedSolomonRemainder(data, degree) {
    const generator = createReedSolomonGenerator(degree);
    const result = Array.from({ length: degree }, () => 0);

    data.forEach((byte) => {
      const factor = byte ^ result.shift();
      result.push(0);

      generator.slice(1).forEach((coefficient, index) => {
        result[index] ^= multiplyGalois(coefficient, factor);
      });
    });

    return result;
  }

  function createReedSolomonGenerator(degree) {
    let generator = [1];

    for (let index = 0; index < degree; index += 1) {
      const next = Array.from({ length: generator.length + 1 }, () => 0);
      generator.forEach((coefficient, coefficientIndex) => {
        next[coefficientIndex] ^= coefficient;
        next[coefficientIndex + 1] ^= multiplyGalois(coefficient, powerGalois(index));
      });
      generator = next;
    }

    return generator;
  }

  function multiplyGalois(left, right) {
    let product = 0;

    for (let index = 0; index < 8; index += 1) {
      if ((right & 1) !== 0) {
        product ^= left;
      }

      const carry = (left & 0x80) !== 0;
      left = (left << 1) & 0xff;
      if (carry) {
        left ^= 0x1d;
      }
      right >>>= 1;
    }

    return product;
  }

  function powerGalois(power) {
    let value = 1;
    for (let index = 0; index < power; index += 1) {
      value = multiplyGalois(value, 2);
    }
    return value;
  }

  function buildRoomUrl(roomId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", roomId);
    return url.toString();
  }

  function extractRoomId(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }

    try {
      const url = new URL(text);
      const room = url.searchParams.get("room");
      return isValidPeerId(room) ? room : "";
    } catch {
      return isValidPeerId(text) ? text : "";
    }
  }

  function isValidPeerId(peerId) {
    return typeof peerId === "string" && PEER_ID_PATTERN.test(peerId);
  }

  function setRoomUrl(roomId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", roomId);
    window.history.replaceState(null, "", url);
  }

  function clearRoomUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  }

  function showRoom() {
    showView("room");
    updateRoomStatus();
  }

  function setRoomStatus(status) {
    els.roomTitle.textContent = status;
  }

  function updateRoomStatus() {
    if (state.participants.size > 1) {
      setRoomStatus(`${state.participants.size}人が参加中`);
      return;
    }
    setRoomStatus("待機中");
  }

  function showView(name) {
    state.mode = name;
    const views = [els.homeView, els.directJoinView, els.scannerView, els.roomView];
    views.forEach((view) => view.classList.remove("is-active"));

    if (name === "home") {
      els.homeView.classList.add("is-active");
    }
    if (name === "directJoin") {
      els.directJoinView.classList.add("is-active");
    }
    if (name === "scanner") {
      els.scannerView.classList.add("is-active");
    }
    if (name === "room") {
      els.roomView.classList.add("is-active");
    }
  }

  function updateConnectionBadge(text) {
    if (els.connectionBadge) {
      els.connectionBadge.textContent = text;
    }
  }

  function setBusy(isBusy) {
    [
      els.startTalkButton,
      els.joinTalkButton,
      els.directJoinButton,
      els.cancelScanButton,
      els.leaveButton,
      els.muteButton,
      els.pocketLockButton,
    ].forEach((button) => {
      button.disabled = isBusy;
    });
  }

  async function populateDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      updateDeviceSupportUI();
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === "audioinput");
    const outputs = devices.filter((device) => device.kind === "audiooutput");

    fillDeviceSelect(els.audioInputSelect, inputs, "システム既定のマイク", state.preferredInputId);

    if (canSelectOutputDevice()) {
      fillDeviceSelect(els.audioOutputSelect, outputs, "システム既定のスピーカー", state.preferredOutputId);
    } else {
      els.audioOutputSelect.innerHTML = "";
      const option = new Option("OS側でスピーカーを選択", "");
      els.audioOutputSelect.add(option);
      els.audioOutputSelect.disabled = true;
    }
  }

  function fillDeviceSelect(select, devices, defaultLabel, selectedValue) {
    select.innerHTML = "";
    select.add(new Option(defaultLabel, ""));
    devices.forEach((device, index) => {
      const label = device.label || `${defaultLabel} ${index + 1}`;
      select.add(new Option(label, device.deviceId));
    });
    select.value = selectedValue;
    select.disabled = devices.length === 0;
  }

  function updateDeviceSupportUI() {
    if (!canSelectOutputDevice()) {
      els.audioOutputSelect.innerHTML = "";
      els.audioOutputSelect.add(new Option("OS側でスピーカーを選択", ""));
      els.audioOutputSelect.disabled = true;
    }
  }

  async function onInputDeviceChange() {
    const previousInputId = state.preferredInputId;
    state.preferredInputId = els.audioInputSelect.value;
    if (!state.localStream) {
      return;
    }

    try {
      const nextStream = await getAudioStream();
      const nextTrack = nextStream.getAudioTracks()[0];
      const currentTrack = state.localStream.getAudioTracks()[0];
      const activeConnectionCount = state.mediaConnections.size;
      const replacedTrackCount = await replaceOutgoingAudioTrack(nextTrack);

      if (activeConnectionCount > 0 && replacedTrackCount === 0) {
        nextTrack.stop();
        state.preferredInputId = previousInputId;
        els.audioInputSelect.value = previousInputId;
        throw new Error("このブラウザでは接続中のマイク切り替えに対応していません。入り直してください。");
      }

      if (currentTrack) {
        state.localStream.removeTrack(currentTrack);
        currentTrack.stop();
      }
      state.localStream.addTrack(nextTrack);
      nextTrack.enabled = !state.muted;
      showToast("マイクを切り替えました。");
    } catch (error) {
      showToast(error.message || "マイクの切り替えに失敗しました。");
    }
  }

  async function replaceOutgoingAudioTrack(track) {
    let replacedTrackCount = 0;
    const replacements = [...state.mediaConnections.values()].map(async (connection) => {
      const pc = connection.peerConnection || connection._pc;
      const sender = pc?.getSenders?.().find((item) => item.track?.kind === "audio");
      if (sender?.replaceTrack) {
        await sender.replaceTrack(track);
        replacedTrackCount += 1;
      }
    });
    await Promise.allSettled(replacements);
    return replacedTrackCount;
  }

  async function onOutputDeviceChange() {
    state.preferredOutputId = els.audioOutputSelect.value;
    await Promise.all([...state.remoteAudios.values()].map((audio) => applyOutputDevice(audio)));
    showToast("スピーカー設定を更新しました。");
  }

  function canSelectOutputDevice() {
    return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  }

  async function applyOutputDevice(audio) {
    if (!canSelectOutputDevice()) {
      return;
    }
    try {
      await audio.setSinkId(state.preferredOutputId || "");
    } catch {
      showToast("このスピーカーはブラウザから選択できません。OS側の出力先を確認してください。");
    }
  }

  function toggleMute() {
    state.muted = !state.muted;
    state.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !state.muted;
    });
    updateMuteButton();
  }

  function updateMuteButton() {
    els.muteButton.classList.toggle("is-muted", state.muted);
    els.muteButton.setAttribute("aria-pressed", String(state.muted));
    els.muteButton.setAttribute("aria-label", state.muted ? "ミュートを解除" : "ミュート");
    els.muteButtonText.textContent = state.muted ? "ミュート ON" : "ミュート OFF";
    els.muteSlash.hidden = !state.muted;
  }

  function addParticipant(peerId, participantState) {
    if (!peerId || state.participants.has(peerId)) {
      return;
    }
    state.participants.set(peerId, {
      label: shortId(peerId),
      state: participantState,
      lastSeen: Date.now(),
    });
  }

  function setParticipantState(peerId, participantState) {
    if (!peerId || !state.participants.has(peerId)) {
      return;
    }
    const participant = state.participants.get(peerId);
    participant.state = participantState;
    participant.lastSeen = Date.now();
    state.participants.set(peerId, participant);
    renderParticipants();
  }

  function touchParticipant(peerId, participantState = "接続中") {
    if (!peerId || peerId === state.peerId) {
      return;
    }

    const participant = state.participants.get(peerId) || {
      label: shortId(peerId),
      state: participantState,
    };
    participant.lastSeen = Date.now();
    if (participant.state !== "接続済み") {
      participant.state = participantState;
    }
    state.participants.set(peerId, participant);
    updateRoomStatus();
    renderParticipants();
  }

  function renderParticipants() {
    els.participantsList.innerHTML = "";
    [...state.participants.entries()].forEach(([peerId, participant]) => {
      const li = document.createElement("li");
      const id = document.createElement("span");
      const status = document.createElement("span");
      id.className = "participant-id";
      status.className = "participant-state";
      id.textContent = participant.label || shortId(peerId);
      status.textContent = participant.state || "接続中";
      li.append(id, status);
      els.participantsList.append(li);
    });
  }

  function removeParticipant(peerId, { broadcast }) {
    if (!peerId || peerId === state.peerId) {
      return;
    }

    state.participants.delete(peerId);
    detachRemoteAudio(peerId);

    const mediaConnection = state.mediaConnections.get(peerId);
    if (mediaConnection) {
      state.mediaConnections.delete(peerId);
      mediaConnection.close();
    }

    const dataConnection = state.dataConnections.get(peerId);
    if (dataConnection) {
      state.dataConnections.delete(peerId);
      dataConnection.close();
    }

    if (state.hostConnection?.peer === peerId) {
      state.suppressHostCloseNotice = true;
      state.hostConnection.close();
      state.hostConnection = null;
    }

    if (broadcast && state.role === "host" && !state.isLeaving) {
      broadcastHostMessage({ type: "peer-left", peerId }, peerId);
      broadcastRoster();
    }

    if (state.mode === "room") {
      updateRoomStatus();
      renderParticipants();
    }
  }

  function handlePeerLeft(peerId) {
    const wasJoinTarget = peerId === state.hostId;
    if (wasJoinTarget) {
      state.suppressHostCloseNotice = true;
    }

    removeParticipant(peerId, { broadcast: false });

    if (wasJoinTarget) {
      electRoomCoordinator();
    }
  }

  function electRoomCoordinator() {
    if (state.mode !== "room" || !state.peerId) {
      return;
    }

    const nextHostId = [...state.participants.keys()].sort()[0] || state.peerId;
    state.hostId = nextHostId;
    state.roomId = nextHostId;
    setRoomUrl(nextHostId);
    renderRoomQr().catch(() => undefined);

    if (nextHostId === state.peerId) {
      state.role = "host";
      if (state.hostConnection) {
        state.suppressHostCloseNotice = true;
        state.hostConnection.close();
        state.hostConnection = null;
      }
    } else {
      state.role = "guest";
      connectToHost();
    }

    updateRoomStatus();
    renderParticipants();
    broadcastRoster();
  }

  function startPresenceMonitor() {
    stopPresenceMonitor();
    state.presenceTimer = window.setInterval(runPresenceTick, HEARTBEAT_INTERVAL_MS);
    runPresenceTick();
  }

  function stopPresenceMonitor() {
    if (state.presenceTimer) {
      window.clearInterval(state.presenceTimer);
      state.presenceTimer = null;
    }
  }

  function runPresenceTick() {
    if (state.mode !== "room" || !state.peerId) {
      return;
    }

    if (state.role === "host") {
      pruneStaleParticipants();
      broadcastRoster();
      return;
    }

    if (state.hostConnection?.open) {
      sendData(state.hostConnection, { type: "heartbeat", peerId: state.peerId });
    }
  }

  function pruneStaleParticipants() {
    const now = Date.now();
    [...state.participants.entries()].forEach(([peerId, participant]) => {
      if (peerId === state.peerId) {
        return;
      }

      if (participant.lastSeen && now - participant.lastSeen > PARTICIPANT_TIMEOUT_MS) {
        removeParticipant(peerId, { broadcast: true });
      }
    });
  }

  function broadcastRoster() {
    if (state.role !== "host" || state.isLeaving) {
      return;
    }

    broadcastHostMessage({
      type: "roster",
      roomId: state.roomId,
      hostId: state.peerId,
      peers: [...state.participants.keys()],
    });
  }

  function applyRoster(message) {
    if (!Array.isArray(message.peers)) {
      return;
    }

    const rosterPeerIds = new Set(message.peers.filter(isValidPeerId));
    const now = Date.now();

    if (isValidPeerId(message.hostId)) {
      state.hostId = message.hostId;
      state.roomId = message.hostId;
      renderRoomQr().catch(() => undefined);
      setRoomUrl(message.hostId);
    }

    rosterPeerIds.forEach((peerId) => {
      if (peerId === state.peerId) {
        return;
      }
      const participant = state.participants.get(peerId) || {
        label: shortId(peerId),
        state: "接続中",
      };
      participant.lastSeen = now;
      if (participant.state !== "接続済み") {
        participant.state = "接続中";
      }
      state.participants.set(peerId, participant);
    });

    [...state.participants.keys()].forEach((peerId) => {
      if (peerId !== state.peerId && !rosterPeerIds.has(peerId)) {
        removeParticipant(peerId, { broadcast: false });
      }
    });

    updateRoomStatus();
    renderParticipants();
  }

  function broadcastHostMessage(message, exceptPeerId = "") {
    state.dataConnections.forEach((connection, peerId) => {
      if (peerId !== exceptPeerId) {
        sendData(connection, message);
      }
    });
  }

  function sendData(connection, message) {
    if (connection?.open) {
      connection.send(message);
    }
  }

  async function leaveRoom(message = "") {
    if (state.role === "host") {
      broadcastHostMessage({ type: "peer-left", peerId: state.peerId });
      await wait(120);
    } else if (state.hostConnection?.open) {
      sendData(state.hostConnection, { type: "leave", peerId: state.peerId });
    }

    state.isLeaving = true;
    stopRoomResources();
    clearRoomUrl();
    state.pendingRoomId = null;
    updateConnectionBadge("待機中");
    showView("home");
    state.isLeaving = false;
    if (message) {
      showToast(message);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function stopRoomResources() {
    stopPresenceMonitor();
    releaseWakeLock();

    state.dataConnections.forEach((connection) => connection.close());
    state.dataConnections.clear();

    if (state.hostConnection) {
      state.hostConnection.close();
      state.hostConnection = null;
    }

    state.mediaConnections.forEach((connection) => connection.close());
    state.mediaConnections.clear();

    state.remoteAudios.forEach((audio) => {
      audio.srcObject = null;
      audio.remove();
    });
    state.remoteAudios.clear();

    if (state.peer && !state.peer.destroyed) {
      state.peer.destroy();
    }

    state.localStream?.getTracks().forEach((track) => track.stop());
    state.localStream = null;
    state.peer = null;
    state.role = null;
    state.roomId = null;
    state.hostId = null;
    state.peerId = null;
    state.suppressHostCloseNotice = false;
    state.muted = false;
    state.participants.clear();
    updateMuteButton();
    els.audioUnlockButton.classList.add("hidden");
    disablePocketLock();
  }

  function notifyLeaveBeforeUnload() {
    if (state.role === "guest" && state.hostConnection?.open) {
      sendData(state.hostConnection, { type: "leave", peerId: state.peerId });
    }
    if (state.role === "host") {
      broadcastHostMessage({ type: "peer-left", peerId: state.peerId });
    }
  }

  async function requestWakeLock() {
    state.wakeWanted = true;

    if (state.wakeLock) {
      return;
    }

    if (!("wakeLock" in navigator)) {
      return;
    }

    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    } catch {
      state.wakeLock = null;
    }
  }

  function releaseWakeLock() {
    state.wakeWanted = false;
    if (state.wakeLock) {
      state.wakeLock.release().catch(() => undefined);
      state.wakeLock = null;
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === "visible" && state.mode === "room" && state.wakeWanted && !state.wakeLock) {
      requestWakeLock().catch(() => undefined);
    }
  }

  function enablePocketLock() {
    els.pocketOverlay.classList.remove("hidden");
    requestWakeLock().catch(() => undefined);
  }

  function disablePocketLock() {
    els.pocketOverlay.classList.add("hidden");
    cancelUnlockHold();
  }

  function beginUnlockHold() {
    cancelUnlockHold();
    state.unlockTimer = window.setTimeout(() => {
      disablePocketLock();
      showToast("ポケットロックを解除しました。");
    }, UNLOCK_HOLD_MS);
  }

  function cancelUnlockHold() {
    if (state.unlockTimer) {
      window.clearTimeout(state.unlockTimer);
      state.unlockTimer = null;
    }
  }

  async function unlockRemoteAudio() {
    const attempts = [...state.remoteAudios.values()].map((audio) => audio.play());
    const results = await Promise.allSettled(attempts);
    const failed = results.some((result) => result.status === "rejected");
    if (!failed) {
      els.audioUnlockButton.classList.add("hidden");
      showToast("音声再生を有効にしました。");
    }
  }

  async function copyRoomLink() {
    const roomUrl = buildRoomUrl(state.roomId);
    try {
      await navigator.clipboard.writeText(roomUrl);
      showToast("リンクをコピーしました。");
    } catch {
      showToast(roomUrl);
    }
  }

  function handlePeerError(error) {
    const message = error?.type === "peer-unavailable"
      ? "参加先のルームが見つかりません。"
      : error?.message || "PeerJS接続でエラーが発生しました。";

    if (state.mode === "room") {
      showToast(message);
    } else {
      handleFatalError(error);
    }
  }

  function handleFatalError(error) {
    setBusy(false);
    stopScanner();
    const message = error?.message || "処理に失敗しました。";
    showToast(message);
    updateConnectionBadge("エラー");
    if (state.mode !== "room") {
      showView("home");
    }
  }

  function assertRequiredBrowserFeatures() {
    if (!window.isSecureContext) {
      throw new Error("マイクとカメラを使うにはHTTPSまたはlocalhostで開いてください。");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("このブラウザはマイクまたはカメラの取得に対応していません。");
    }
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      els.toast.classList.add("hidden");
    }, 5200);
  }

  function shortId(peerId) {
    if (!peerId) {
      return "";
    }
    return peerId.length > 10 ? `${peerId.slice(0, 5)}...${peerId.slice(-4)}` : peerId;
  }
})();
