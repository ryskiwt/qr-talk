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
  const ROOM_SERVICE_RETRY_MS = 500;
  const ROOM_SERVICE_MAX_RETRIES = 12;
  const COORDINATOR_FAILOVER_MS = 12000;
  const COORDINATOR_CANDIDATE_TIMEOUT_MS = 8000;
  const MEDIA_RECONNECT_RETRY_MS = 1200;
  const PROXIMITY_INTERVAL_MS = 500;
  const PROXIMITY_HISTORY_MS = 1400;
  const PROXIMITY_DECISION_INTERVAL_MS = 2000;
  const PROXIMITY_DECISION_WINDOW_MS = 2000;
  const PROXIMITY_MIN_LAG_MS = 80;
  const PROXIMITY_MAX_LAG_MS = 900;
  const PROXIMITY_MIN_GAIN = 0.22;
  const PROXIMITY_GAIN_LEVELS = [1, 0.72, 0.46, PROXIMITY_MIN_GAIN];
  const PROXIMITY_SCORE_THRESHOLD = 0.45;
  const PROXIMITY_MIN_VOICE_DECISIONS = 2;
  const VAD_MIN_VOICE_ENERGY = 0.035;
  const VAD_MIN_VOICE_RATIO = 0.42;
  const VAD_INITIAL_NOISE_FLOOR = 0.008;
  const VAD_NOISE_MULTIPLIER = 2.4;
  const VAD_NOISE_OFFSET = 0.012;
  const VAD_HANGOVER_TICKS = 1;
  const PARTICIPANT_SPEAKING_ENERGY_THRESHOLD = VAD_MIN_VOICE_ENERGY;
  const PARTICIPANT_SPEAKING_HOLD_MS = 900;
  const LOCAL_MONITOR_GAIN = 0.04;
  const LOCATION_WATCH_MAXIMUM_AGE_MS = 15000;
  const LOCATION_WATCH_TIMEOUT_MS = 20000;
  const LOCATION_STALE_MS = 45000;
  const LOCATION_MAX_ACCURACY_M = 80;
  const LOCATION_FAR_SKIP_DISTANCE_M = 35;
  const UNLOCK_HOLD_MS = 750;
  const HEADSET_ACTION_DEBOUNCE_MS = 550;
  const HEADSET_MUTE_TOGGLE_ACTIONS = ["togglemicrophone", "hangup", "play", "pause", "stop"];
  const PARTICIPANT_JOIN_TONE = [
    { frequency: 880, duration: 0.08 },
    { frequency: 1174.66, duration: 0.11 },
  ];
  const PARTICIPANT_LEAVE_TONE = [
    { frequency: 659.25, duration: 0.09 },
    { frequency: 440, duration: 0.16 },
  ];

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
    speakerMuteButton: $("#speakerMuteButton"),
    speakerMuteButtonText: $("#speakerMuteButtonText"),
    pocketLockButton: $("#pocketLockButton"),
    leaveButton: $("#leaveButton"),
    audioInputSelect: $("#audioInputSelect"),
    audioOutputSelect: $("#audioOutputSelect"),
    audioUnlockButton: $("#audioUnlockButton"),
    participantsList: $("#participantsList"),
    remoteAudioMount: $("#remoteAudioMount"),
    pocketOverlay: $("#pocketOverlay"),
    pocketMuteHoldButton: $("#pocketMuteHoldButton"),
    pocketMuteHoldText: $("#pocketMuteHoldText"),
    pocketSpeakerMuteHoldButton: $("#pocketSpeakerMuteHoldButton"),
    pocketSpeakerMuteHoldText: $("#pocketSpeakerMuteHoldText"),
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
    roomPeer: null,
    roomPeerPromise: null,
    roomPeerRecoverTimer: null,
    localStream: null,
    scannerStream: null,
    scanTimer: null,
    barcodeDetector: null,
    hostConnection: null,
    dataConnections: new Map(),
    mediaConnections: new Map(),
    remoteAudios: new Map(),
    remoteProcessors: new Map(),
    participants: new Map(),
    presenceTimer: null,
    proximityTimer: null,
    audioContext: null,
    localAudioSource: null,
    localMonitorGain: null,
    localAnalyser: null,
    localFrequencyData: null,
    localVad: null,
    localFeatureHistory: [],
    locationWatchId: null,
    locationNoticeShown: false,
    silentAudioSource: null,
    silentAudioGain: null,
    silentAudioDestination: null,
    silentAudioTrack: null,
    isLeaving: false,
    suppressHostCloseNotice: false,
    muted: false,
    speakerMuted: false,
    preferredInputId: "",
    preferredOutputId: "",
    wakeLock: null,
    wakeWanted: false,
    unlockTimer: null,
    pocketMuteTimer: null,
    pocketSpeakerMuteTimer: null,
    lastHeadsetActionAt: 0,
    hostReconnectTimer: null,
    hostReconnectAttempts: 0,
    hostReconnectFailureHandledAttempt: 0,
    hostReconnectStartedAt: 0,
    hostFailoverCandidateId: "",
    hostFailoverCandidateStartedAt: 0,
    failedHostIds: new Set(),
    peerReconnectTimer: null,
    roomEstablished: false,
    roomGeneration: 0,
    displayName: "",
    displayNameDraft: "",
    displayNameEditMode: false,
    displayNameFocusRequested: false,
    suppressDisplayNameBlurCommit: false,
    mediaReconnectTimers: new Map(),
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindEvents();
    updateMuteButton();
    updateSpeakerMuteButton();
    const roomId = extractRoomId(window.location.href);
    if (roomId) {
      state.pendingRoomId = roomId;
      showView("directJoin");
    } else {
      showView("home");
    }
    updateConnectionBadge("待機中");
    updateDeviceSupportUI();
    setupMediaSessionControls();
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
    els.muteButton.addEventListener("click", () => toggleMute().catch(handleFatalError));
    els.speakerMuteButton.addEventListener("click", toggleSpeakerMute);
    els.pocketLockButton.addEventListener("click", enablePocketLock);
    els.copyLinkButton.addEventListener("click", copyRoomLink);
    els.audioInputSelect.addEventListener("change", onInputDeviceChange);
    els.audioOutputSelect.addEventListener("change", onOutputDeviceChange);
    els.audioUnlockButton.addEventListener("click", unlockRemoteAudio);
    els.unlockHoldButton.addEventListener("pointerdown", beginUnlockHold);
    els.unlockHoldButton.addEventListener("pointerup", cancelUnlockHold);
    els.unlockHoldButton.addEventListener("pointercancel", cancelUnlockHold);
    els.unlockHoldButton.addEventListener("pointerleave", cancelUnlockHold);
    els.pocketMuteHoldButton.addEventListener("pointerdown", beginPocketMuteHold);
    els.pocketMuteHoldButton.addEventListener("pointerup", cancelPocketMuteHold);
    els.pocketMuteHoldButton.addEventListener("pointercancel", cancelPocketMuteHold);
    els.pocketMuteHoldButton.addEventListener("pointerleave", cancelPocketMuteHold);
    els.pocketSpeakerMuteHoldButton.addEventListener("pointerdown", beginPocketSpeakerMuteHold);
    els.pocketSpeakerMuteHoldButton.addEventListener("pointerup", cancelPocketSpeakerMuteHold);
    els.pocketSpeakerMuteHoldButton.addEventListener("pointercancel", cancelPocketSpeakerMuteHold);
    els.pocketSpeakerMuteHoldButton.addEventListener("pointerleave", cancelPocketSpeakerMuteHold);
    els.pocketOverlay.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", notifyLeaveBeforeUnload);

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", () => {
        populateDevices().catch(() => undefined);
      });
    }
  }

  function setupMediaSessionControls() {
    if (!("mediaSession" in navigator)) {
      return;
    }

    if ("MediaMetadata" in window) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: "QR Talk",
          artist: "音声トーク",
        });
      } catch {
        // Metadata is only a hint for OS-level controls.
      }
    }

    HEADSET_MUTE_TOGGLE_ACTIONS.forEach((action) => {
      setMediaSessionActionHandler(action, (details) => {
        handleHeadsetMuteAction(action, details).catch(handleFatalError);
      });
    });
    updateMediaSessionState();
  }

  function setMediaSessionActionHandler(action, handler) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Some browsers expose Media Session but not every action.
    }
  }

  async function handleHeadsetMuteAction(action, details = {}) {
    if (state.mode !== "room" || !state.localStream) {
      return;
    }

    const now = performance.now();
    if (now - state.lastHeadsetActionAt < HEADSET_ACTION_DEBOUNCE_MS) {
      return;
    }
    state.lastHeadsetActionAt = now;

    const changed = action === "togglemicrophone" && typeof details.isActivating === "boolean"
      ? await setMuteState(!details.isActivating)
      : await toggleMute();

    if (changed) {
      showToast(state.muted ? "マイクをOFFにしました。" : "マイクをONにしました。");
    }
  }

  function updateMediaSessionState() {
    if (!("mediaSession" in navigator)) {
      return;
    }

    try {
      navigator.mediaSession.playbackState = state.mode === "room" ? "playing" : "none";
    } catch {
      // Playback state is optional browser integration.
    }

    if (typeof navigator.mediaSession.setMicrophoneActive === "function") {
      try {
        navigator.mediaSession.setMicrophoneActive(state.mode === "room" && !state.muted);
      } catch {
        // Microphone state reporting is not supported everywhere.
      }
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
      await setupLocalAudioAnalysis();
      await populateDevices();

      state.role = role;
      state.peer = createPeer();
      bindParticipantPeerEvents(state.peer);

      const peerId = await waitForPeerOpen(state.peer);
      state.peerId = peerId;
      state.roomId = role === "host" ? generateRoomId() : roomId;
      state.hostId = role === "host" ? peerId : null;
      state.roomEstablished = role === "host";
      state.roomGeneration = role === "host" ? 1 : 0;
      state.participants.set(peerId, {
        label: getLocalParticipantLabel(),
        state: "自分",
      });

      if (role === "host") {
        await ensureRoomServicePeer();
      }

      showRoom();
      renderParticipants();
      await renderRoomQr();
      setRoomUrl(state.roomId);
      startPresenceMonitor();
      startProximityMonitor();
      startLocationMonitor();
      await requestWakeLock();

      if (role === "guest") {
        resetHostReconnectState();
        scheduleHostReconnect(0);
      } else {
        updateConnectionBadge("接続中");
        updateRoomStatus();
      }
    } finally {
      setBusy(false);
    }
  }

  function generateRoomId() {
    if (window.crypto?.randomUUID) {
      return `room-${window.crypto.randomUUID()}`;
    }

    const bytes = window.crypto?.getRandomValues
      ? window.crypto.getRandomValues(new Uint8Array(16))
      : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    const text = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `room-${text}`;
  }

  function createPeer(peerId = undefined) {
    if (typeof window.Peer !== "function") {
      throw new Error("PeerJSを読み込めませんでした。ネットワーク接続を確認してください。");
    }
    return new window.Peer(peerId, PEER_OPTIONS);
  }

  function bindParticipantPeerEvents(peer) {
    peer.on("call", (call) => handleIncomingCall(call));
    peer.on("open", () => handleParticipantPeerOpen(peer));
    peer.on("disconnected", () => handleParticipantPeerDisconnected(peer));
    peer.on("close", () => handleParticipantPeerClosed(peer));
    peer.on("error", (error) => handlePeerError(error));
  }

  function bindRoomServicePeerEvents(peer) {
    peer.on("connection", (connection) => handleIncomingDataConnection(connection));
    peer.on("open", () => {
      if (state.roomPeer === peer) {
        cancelRoomServicePeerRecover();
      }
    });
    peer.on("disconnected", () => {
      if (state.roomPeer === peer) {
        scheduleRoomServicePeerRecover();
      }
    });
    peer.on("close", () => {
      if (state.roomPeer === peer) {
        state.roomPeer = null;
        scheduleRoomServicePeerRecover();
      }
    });
    peer.on("error", () => {
      if (state.roomPeer === peer) {
        if (peer.destroyed) {
          state.roomPeer = null;
        }
        scheduleRoomServicePeerRecover();
      }
    });
  }

  function handleParticipantPeerOpen(peer) {
    if (state.peer !== peer) {
      return;
    }

    cancelParticipantPeerReconnect();
    if (state.mode !== "room" || state.isLeaving) {
      return;
    }

    updateConnectionBadge("接続中");

    if (state.role === "guest" && !state.hostConnection?.open) {
      scheduleHostReconnect(0);
    }

    scheduleMissingMediaReconnects();
  }

  function handleParticipantPeerDisconnected(peer) {
    if (state.peer !== peer) {
      return;
    }

    updateConnectionBadge("シグナリング切断");
    scheduleParticipantPeerReconnect();
  }

  function handleParticipantPeerClosed(peer) {
    if (state.peer !== peer) {
      return;
    }

    cancelParticipantPeerReconnect();
    updateConnectionBadge("切断");
  }

  function waitForPeerOpen(peer) {
    return new Promise((resolve, reject) => {
      peer.once("open", resolve);
      peer.once("error", reject);
    });
  }

  async function ensureRoomServicePeer() {
    if (state.role !== "host" || !state.roomId) {
      return null;
    }

    if (state.roomPeer && !state.roomPeer.destroyed && state.roomPeer.open) {
      cancelRoomServicePeerRecover();
      return state.roomPeer;
    }

    if (state.roomPeerPromise) {
      return state.roomPeerPromise;
    }

    state.roomPeerPromise = openRoomServicePeer();
    try {
      return await state.roomPeerPromise;
    } finally {
      state.roomPeerPromise = null;
    }
  }

  async function openRoomServicePeer() {
    const roomId = state.roomId;
    let lastError = null;

    for (let attempt = 0; attempt < ROOM_SERVICE_MAX_RETRIES; attempt += 1) {
      if (state.role !== "host" || state.roomId !== roomId) {
        return null;
      }

      closeRoomServicePeer();
      const peer = createPeer(roomId);
      state.roomPeer = peer;
      bindRoomServicePeerEvents(peer);

      try {
        await waitForPeerOpen(peer);
        return peer;
      } catch (error) {
        lastError = error;
        if (state.roomPeer === peer) {
          state.roomPeer = null;
        }
        peer.destroy();
        if (attempt < ROOM_SERVICE_MAX_RETRIES - 1) {
          await wait(ROOM_SERVICE_RETRY_MS);
        }
      }
    }

    throw lastError || new Error("参加受付の開始に失敗しました。");
  }

  function closeRoomServicePeer() {
    if (state.roomPeer && !state.roomPeer.destroyed) {
      state.roomPeer.destroy();
    }
    state.roomPeer = null;
  }

  function scheduleRoomServicePeerRecover(delayMs = ROOM_SERVICE_RETRY_MS) {
    cancelRoomServicePeerRecover();
    if (state.mode !== "room" || state.role !== "host" || !state.roomId || state.isLeaving) {
      return;
    }

    state.roomPeerRecoverTimer = window.setTimeout(() => {
      state.roomPeerRecoverTimer = null;
      if (state.mode !== "room" || state.role !== "host" || !state.roomId || state.isLeaving) {
        return;
      }

      ensureRoomServicePeer()
        .then((peer) => {
          if (!peer) {
            return;
          }
          updateConnectionBadge("接続中");
          broadcastRoster();
        })
        .catch((error) => handleRoomServicePeerRecoverFailure(error));
    }, delayMs);
  }

  function cancelRoomServicePeerRecover() {
    if (state.roomPeerRecoverTimer) {
      window.clearTimeout(state.roomPeerRecoverTimer);
      state.roomPeerRecoverTimer = null;
    }
  }

  function handleRoomServicePeerRecoverFailure() {
    if (state.mode !== "room" || state.role !== "host" || !state.roomId || state.isLeaving) {
      return;
    }

    if (state.roomEstablished && state.participants.size > 1) {
      const nextHostId = pickNextRoomCoordinator(state.peerId);
      if (nextHostId && nextHostId !== state.peerId) {
        showToast("新しい参加受付に接続しています。");
        relinquishRoomCoordinator(nextHostId, { connect: true });
        return;
      }
    }

    scheduleRoomServicePeerRecover();
  }

  function scheduleHostReconnect(delayMs = ROOM_SERVICE_RETRY_MS) {
    cancelHostReconnect();
    if (state.mode !== "room" || state.role !== "guest") {
      return;
    }

    state.hostReconnectTimer = window.setTimeout(() => {
      state.hostReconnectTimer = null;
      if (state.mode !== "room" || state.role !== "guest") {
        return;
      }

      state.hostReconnectAttempts += 1;
      connectToHost().catch((error) => handleHostReconnectFailure(error));
    }, delayMs);
  }

  function cancelHostReconnect() {
    if (state.hostReconnectTimer) {
      window.clearTimeout(state.hostReconnectTimer);
      state.hostReconnectTimer = null;
    }
  }

  function resetHostReconnectState() {
    state.hostReconnectAttempts = 0;
    state.hostReconnectFailureHandledAttempt = 0;
    state.hostReconnectStartedAt = 0;
    state.hostFailoverCandidateId = "";
    state.hostFailoverCandidateStartedAt = 0;
    state.failedHostIds.clear();
  }

  function startHostReconnectWindow(previousHostId = state.hostId) {
    if (state.hostReconnectStartedAt) {
      return;
    }

    state.hostReconnectStartedAt = Date.now();
    state.hostFailoverCandidateId = "";
    state.hostFailoverCandidateStartedAt = 0;
    state.failedHostIds.clear();
    if (isValidPeerId(previousHostId)) {
      state.failedHostIds.add(previousHostId);
    }
  }

  function handleHostReconnectFailure(error) {
    if (state.mode !== "room" || state.role !== "guest" || state.isLeaving || state.hostReconnectAttempts < 1) {
      return false;
    }

    const attempt = state.hostReconnectAttempts;
    if (state.hostReconnectFailureHandledAttempt === attempt) {
      return true;
    }
    state.hostReconnectFailureHandledAttempt = attempt;

    if (!state.roomEstablished) {
      if (attempt >= ROOM_SERVICE_MAX_RETRIES) {
        showToast("参加受付が見つからないため、この端末で受付を開始します。");
        electRoomCoordinator(state.hostId).catch(handleFatalError);
        return true;
      }

      if (attempt === 1) {
        const message = error?.type === "peer-unavailable"
          ? "参加先のルームへ接続しています。"
          : "ルームへの接続を再試行しています。";
        showToast(message);
      }
      scheduleHostReconnect();
      return true;
    }

    startHostReconnectWindow(state.hostId);

    if (attempt === 1) {
      showToast("参加受付を確認しています。");
    }

    const elapsedMs = Date.now() - state.hostReconnectStartedAt;
    if (elapsedMs >= COORDINATOR_FAILOVER_MS && handleCoordinatorFailoverCandidate()) {
      return true;
    }

    scheduleHostReconnect();
    return true;
  }

  function handleCoordinatorFailoverCandidate() {
    const candidateId = getCoordinatorFailoverCandidate();
    if (!candidateId) {
      scheduleHostReconnect();
      return true;
    }

    if (candidateId === state.peerId) {
      const previousHostId = state.hostId;
      if (previousHostId && previousHostId !== state.peerId) {
        removeParticipant(previousHostId, { broadcast: false, playTone: false });
      }
      showToast("参加受付を引き継いでいます。");
      electRoomCoordinator(previousHostId).catch(handleFatalError);
      return true;
    }

    if (state.hostId !== candidateId) {
      state.hostId = candidateId;
      showToast("新しい参加受付に接続しています。");
      renderParticipants();
    }

    if (Date.now() - state.hostFailoverCandidateStartedAt >= COORDINATOR_CANDIDATE_TIMEOUT_MS) {
      state.failedHostIds.add(candidateId);
      removeParticipant(candidateId, { broadcast: false, playTone: false });
      state.hostFailoverCandidateId = "";
      state.hostFailoverCandidateStartedAt = 0;
      scheduleHostReconnect(0);
      return true;
    }

    scheduleHostReconnect();
    return true;
  }

  function getCoordinatorFailoverCandidate() {
    const currentCandidateId = state.hostFailoverCandidateId;
    if (
      currentCandidateId
      && (
        currentCandidateId === state.peerId
        || (state.participants.has(currentCandidateId) && !state.failedHostIds.has(currentCandidateId))
      )
    ) {
      return currentCandidateId;
    }

    const candidateId = pickNextRoomCoordinator(state.failedHostIds);
    state.hostFailoverCandidateId = candidateId;
    state.hostFailoverCandidateStartedAt = Date.now();
    return candidateId;
  }

  function isPendingHostReconnectError(error) {
    return error?.type === "peer-unavailable"
      && state.mode === "room"
      && state.role === "guest"
      && !state.isLeaving
      && !state.hostConnection?.open
      && state.hostReconnectAttempts > 0;
  }

  function scheduleParticipantPeerReconnect(delayMs = ROOM_SERVICE_RETRY_MS) {
    cancelParticipantPeerReconnect();
    if (state.mode !== "room" || !state.peer || state.peer.destroyed || state.isLeaving) {
      return;
    }

    state.peerReconnectTimer = window.setTimeout(() => {
      state.peerReconnectTimer = null;
      if (state.mode !== "room" || !state.peer || state.peer.destroyed || state.isLeaving) {
        return;
      }

      if (!state.peer.disconnected) {
        return;
      }

      try {
        state.peer.reconnect();
      } catch {
        scheduleParticipantPeerReconnect();
        return;
      }

      if (state.peer.disconnected) {
        scheduleParticipantPeerReconnect();
      }
    }, delayMs);
  }

  function cancelParticipantPeerReconnect() {
    if (state.peerReconnectTimer) {
      window.clearTimeout(state.peerReconnectTimer);
      state.peerReconnectTimer = null;
    }
  }

  async function getAudioStream() {
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      latency: { ideal: 0.01 },
    };

    if (state.preferredInputId) {
      audio.deviceId = { exact: state.preferredInputId };
    }

    return navigator.mediaDevices.getUserMedia({ audio, video: false });
  }

  async function getOutboundStream() {
    return new MediaStream([await getOutboundAudioTrack()]);
  }

  async function getOutboundAudioTrack() {
    if (state.muted) {
      return getSilentAudioTrack();
    }

    const track = state.localStream?.getAudioTracks()[0];
    if (!track) {
      throw new Error("送信用のマイクが見つかりません。");
    }
    track.enabled = true;
    return track;
  }

  async function getSilentAudioTrack() {
    if (state.silentAudioTrack && state.silentAudioTrack.readyState === "live") {
      return state.silentAudioTrack;
    }

    const audioContext = await ensureAudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();

    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();

    state.silentAudioSource = oscillator;
    state.silentAudioGain = gain;
    state.silentAudioDestination = destination;
    state.silentAudioTrack = destination.stream.getAudioTracks()[0];
    return state.silentAudioTrack;
  }

  function connectToHost() {
    if (!state.peer || !state.roomId || state.role !== "guest") {
      throw new Error("参加先のルームが正しくありません。");
    }

    if (state.hostConnection?.peer === state.roomId && state.hostConnection.open) {
      return Promise.resolve();
    }

    cancelHostReconnect();

    if (state.hostConnection) {
      state.suppressHostCloseNotice = true;
      state.hostConnection.close();
      state.hostConnection = null;
    }

    setRoomStatus("ルームへ接続中");
    const connection = state.peer.connect(state.roomId, {
      reliable: true,
      metadata: { role: "guest", peerId: state.peerId },
    });

    state.hostConnection = connection;

    return new Promise((resolve, reject) => {
      let opened = false;
      let settled = false;

      const settleReject = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const settleResolve = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      connection.on("open", () => {
        opened = true;
        sendData(connection, {
          type: "join",
          peerId: state.peerId,
          displayName: state.displayName,
          hostId: state.hostId,
          generation: state.roomGeneration,
        });
        shareLocalLocation();
        updateConnectionBadge("接続中");
        settleResolve();
      });
      connection.on("data", (message) => handleHostMessage(message, connection));
      connection.on("close", () => {
        if (!opened) {
          if (state.hostConnection === connection) {
            state.hostConnection = null;
          }
          settleReject(new Error("参加受付に接続できませんでした。"));
          return;
        }
        handleHostConnectionClosed(connection);
      });
      connection.on("error", (error) => {
        if (!opened) {
          if (state.hostConnection === connection) {
            state.hostConnection = null;
          }
          settleReject(error);
          return;
        }
        handleHostConnectionClosed(connection);
      });
    });
  }

  function handleHostConnectionClosed(connection) {
    const shouldIgnore = state.suppressHostCloseNotice;
    state.suppressHostCloseNotice = false;

    if (state.hostConnection !== connection) {
      return;
    }
    state.hostConnection = null;

    if (shouldIgnore || state.isLeaving || state.mode !== "room" || state.role !== "guest") {
      return;
    }

    if (!state.roomEstablished) {
      if (state.hostReconnectAttempts >= ROOM_SERVICE_MAX_RETRIES) {
        showToast("参加受付が見つからないため、この端末で受付を開始します。");
        electRoomCoordinator(state.hostId).catch(handleFatalError);
        return;
      }
      scheduleHostReconnect();
      return;
    }

    startHostReconnectWindow(state.hostId);
    scheduleHostReconnect();
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
        if (shouldRelinquishForJoiningPeer(message)) {
          connection.close();
          return;
        }
        acceptParticipant(connection, message);
      }
      if (message.type === "leave") {
        removeParticipant(remotePeerId, { broadcast: true });
      }
      if (message.type === "heartbeat") {
        touchParticipant(remotePeerId, "接続中");
        maybeUpdateParticipantName(remotePeerId, message.displayName);
      }
      if (message.type === "location-update") {
        touchParticipant(remotePeerId, "接続中");
        maybeUpdateParticipantName(remotePeerId, message.displayName);
        setParticipantLocation(remotePeerId, message.location);
      }
      if (message.type === "name-update") {
        touchParticipant(remotePeerId, "接続中");
        maybeUpdateParticipantName(remotePeerId, message.displayName);
        broadcastRoster();
      }
    });
    connection.on("close", () => {
      if (!state.isLeaving && !connection.__skipParticipantRemove) {
        removeParticipant(remotePeerId, { broadcast: true });
      }
    });
    connection.on("error", () => {
      if (!state.isLeaving && !connection.__skipParticipantRemove) {
        removeParticipant(remotePeerId, { broadcast: true });
      }
    });
  }

  function shouldRelinquishForJoiningPeer(message = {}) {
    if (state.role !== "host") {
      return false;
    }

    const nextGeneration = getMessageGeneration(message);
    const nextHostId = isValidPeerId(message.hostId) ? message.hostId : "";
    if (!nextHostId || nextHostId === state.peerId) {
      return false;
    }

    const newerGeneration = nextGeneration > state.roomGeneration;
    const sameGenerationLosesTie = nextGeneration === state.roomGeneration
      && nextHostId.localeCompare(state.peerId) < 0;

    if (!newerGeneration && !sameGenerationLosesTie) {
      return false;
    }

    state.roomGeneration = nextGeneration;
    showToast("新しい参加受付に接続しています。");
    relinquishRoomCoordinator(nextHostId, { connect: true });
    return true;
  }

  function acceptParticipant(connection, message = {}) {
    const remotePeerId = connection.peer;
    const isNewParticipant = !state.participants.has(remotePeerId);
    const existingPeers = [...state.participants.keys()].filter((peerId) => peerId !== remotePeerId);
    const existingParticipant = state.participants.get(remotePeerId) || {};
    const remoteLabel = formatParticipantLabel(message.displayName, remotePeerId);

    state.participants.set(remotePeerId, {
      ...existingParticipant,
      label: remoteLabel,
      state: "接続中",
      lastSeen: Date.now(),
    });
    if (isNewParticipant) {
      playParticipantTone("join");
    }

    sendData(connection, {
      type: "room-state",
      roomId: state.roomId,
      hostId: state.peerId,
      generation: state.roomGeneration,
      peers: existingPeers,
      names: serializeParticipantNames(),
      locations: serializeParticipantLocations(),
    });
    broadcastHostMessage({ type: "peer-joined", peerId: remotePeerId }, remotePeerId);
    broadcastRoster();
    updateRoomStatus();
    renderParticipants();
  }

  function getMessageGeneration(message = {}) {
    const generation = Number(message.generation);
    return Number.isInteger(generation) && generation >= 0 ? generation : 0;
  }

  function shouldAcceptCoordinatorState(hostId, generation) {
    if (!isValidPeerId(hostId)) {
      return false;
    }

    if (generation > state.roomGeneration) {
      return true;
    }

    if (generation < state.roomGeneration) {
      return false;
    }

    if (!state.hostId || hostId === state.hostId) {
      return true;
    }

    return hostId.localeCompare(state.hostId) < 0;
  }

  function applyCoordinatorState(message = {}) {
    const nextHostId = isValidPeerId(message.hostId) ? message.hostId : "";
    const nextGeneration = getMessageGeneration(message);
    if (!shouldAcceptCoordinatorState(nextHostId, nextGeneration)) {
      return false;
    }

    const wasHost = state.role === "host";
    state.hostId = nextHostId;
    state.roomGeneration = nextGeneration;
    state.roomEstablished = true;
    resetHostReconnectState();

    if (wasHost && nextHostId !== state.peerId) {
      relinquishRoomCoordinator(nextHostId, { connect: true });
    }

    return true;
  }

  function closeStaleHostConnection(connection) {
    if (connection && state.hostConnection === connection) {
      state.suppressHostCloseNotice = true;
      connection.close();
      state.hostConnection = null;
      scheduleHostReconnect(0);
    }
  }

  function handleHostMessage(message, connection = null) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "room-state") {
      if (!applyCoordinatorState(message)) {
        closeStaleHostConnection(connection);
        return;
      }
      if (isValidPeerId(message.roomId)) {
        state.roomId = message.roomId;
      }
      cancelHostReconnect();
      const peerIds = Array.isArray(message.peers) ? message.peers : [];
      peerIds
        .filter((peerId) => peerId !== state.peerId)
        .forEach((peerId) => {
          addParticipant(peerId, "接続中");
          callPeer(peerId).catch(() => setParticipantState(peerId, "接続エラー"));
        });
      applyParticipantNames(message.names);
      applyParticipantLocations(message.locations);
      setRoomUrl(state.roomId);
      updateRoomStatus();
      renderParticipants();
      renderRoomQr().catch(() => undefined);
    }

    if (
      (message.type === "peer-joined" || message.type === "peer-left" || message.type === "room-closed")
      && isValidPeerId(message.hostId)
      && !applyCoordinatorState(message)
    ) {
      closeStaleHostConnection(connection);
      return;
    }

    if (message.type === "peer-joined" && message.peerId !== state.peerId) {
      const alreadyKnown = state.participants.has(message.peerId);
      addParticipant(message.peerId, "接続中");
      if (!alreadyKnown) {
        playParticipantTone("join");
      }
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
    getOutboundStream()
      .then((stream) => call.answer(stream))
      .catch(() => call.answer(state.localStream));
    renderParticipants();
  }

  async function callPeer(peerId) {
    if (!state.peer || !state.localStream || peerId === state.peerId || state.mediaConnections.has(peerId)) {
      return;
    }

    cancelMediaReconnect(peerId);
    const call = state.peer.call(peerId, await getOutboundStream(), {
      metadata: { roomId: state.roomId, peerId: state.peerId },
    });
    addParticipant(peerId, "接続中");
    registerMediaConnection(call);
  }

  function registerMediaConnection(call) {
    const peerId = call.peer;
    const existing = state.mediaConnections.get(peerId);
    if (existing && existing !== call) {
      existing.__skipReconnect = true;
      existing.close();
    }

    cancelMediaReconnect(peerId);
    state.mediaConnections.set(peerId, call);

    call.on("stream", (stream) => {
      cancelMediaReconnect(peerId);
      attachRemoteAudio(peerId, stream);
      setParticipantState(peerId, "接続済み");
    });
    call.on("close", () => {
      if (state.mediaConnections.get(peerId) === call) {
        state.mediaConnections.delete(peerId);
        detachRemoteAudio(peerId);
        setParticipantState(peerId, "未接続");
      }
      if (!call.__skipReconnect) {
        scheduleMediaReconnect(peerId);
      }
    });
    call.on("error", () => {
      if (state.mediaConnections.get(peerId) === call) {
        state.mediaConnections.delete(peerId);
        detachRemoteAudio(peerId);
        setParticipantState(peerId, "接続エラー");
      }
      if (!call.__skipReconnect) {
        scheduleMediaReconnect(peerId);
      }
    });
  }

  async function attachRemoteAudio(peerId, stream) {
    detachRemoteAudio(peerId);

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = stream;
    audio.volume = state.speakerMuted ? 0 : 1;
    audio.dataset.peerId = peerId;
    els.remoteAudioMount.append(audio);
    state.remoteAudios.set(peerId, audio);
    await setupRemoteAudioAnalysis(peerId, stream);
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
    disconnectRemoteProcessor(peerId);

    const audio = state.remoteAudios.get(peerId);
    if (!audio) {
      return;
    }
    audio.srcObject = null;
    audio.remove();
    state.remoteAudios.delete(peerId);
  }

  async function setupRemoteAudioAnalysis(peerId, stream) {
    try {
      const audioContext = await ensureAudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;

      source.connect(analyser);

      state.remoteProcessors.set(peerId, {
        source,
        analyser,
        frequencyData: new Uint8Array(analyser.frequencyBinCount),
        vad: createVadState(),
        proximityDecisions: [],
        lastLevelDecisionAt: 0,
        levelIndex: 0,
        targetGain: 1,
        currentGain: 1,
        suppressionPercent: 0,
      });
    } catch {
      state.remoteProcessors.delete(peerId);
    }
  }

  function disconnectRemoteProcessor(peerId) {
    const processor = state.remoteProcessors.get(peerId);
    if (!processor) {
      return;
    }

    [processor.source, processor.analyser].forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    });
    state.remoteProcessors.delete(peerId);
    setParticipantSuppression(peerId, 0);
    setParticipantSpeaking(peerId, false);
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
      try {
        const codes = await state.barcodeDetector.detect(video);
        const value = codes[0]?.rawValue || "";
        if (value) {
          return value;
        }
      } catch {
        state.barcodeDetector = null;
      }
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
    updateMediaSessionState();
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
      els.speakerMuteButton,
      els.pocketLockButton,
      els.pocketMuteHoldButton,
      els.pocketSpeakerMuteHoldButton,
      els.unlockHoldButton,
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
      if (currentTrack) {
        state.localStream.removeTrack(currentTrack);
        currentTrack.stop();
      }
      state.localStream.addTrack(nextTrack);
      nextTrack.enabled = true;
      await setupLocalAudioAnalysis();

      const activeConnectionCount = state.mediaConnections.size;
      const replacedTrackCount = await syncOutgoingAudioTrack();
      if (activeConnectionCount > 0 && replacedTrackCount === 0) {
        state.preferredInputId = previousInputId;
        els.audioInputSelect.value = previousInputId;
        throw new Error("このブラウザでは接続中のマイク切り替えに対応していません。入り直してください。");
      }

      showToast("マイクを切り替えました。");
    } catch (error) {
      showToast(error.message || "マイクの切り替えに失敗しました。");
    }
  }

  async function syncOutgoingAudioTrack() {
    return replaceOutgoingAudioTrack(await getOutboundAudioTrack());
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

  async function toggleMute() {
    return setMuteState(!state.muted);
  }

  function toggleSpeakerMute() {
    return setSpeakerMuteState(!state.speakerMuted);
  }

  function setSpeakerMuteState(nextMuted) {
    if (state.speakerMuted === nextMuted) {
      updateSpeakerMuteButton();
      applyAllRemoteOutputVolumes();
      return false;
    }

    state.speakerMuted = nextMuted;
    updateSpeakerMuteButton();
    applyAllRemoteOutputVolumes();
    return true;
  }

  async function setMuteState(nextMuted) {
    if (state.muted === nextMuted) {
      updateMuteButton();
      updateMediaSessionState();
      updateLocalMonitorGain();
      return false;
    }

    const previousMuted = state.muted;
    state.muted = nextMuted;
    const activeConnectionCount = state.mediaConnections.size;
    let replacedTrackCount = 0;

    try {
      replacedTrackCount = await syncOutgoingAudioTrack();
    } catch (error) {
      state.muted = previousMuted;
      updateMuteButton();
      updateMediaSessionState();
      throw error;
    }

    if (activeConnectionCount > 0 && replacedTrackCount === 0) {
      state.muted = previousMuted;
      showToast("このブラウザでは接続中のマイクON/OFF切り替えに対応していません。");
      updateMuteButton();
      updateMediaSessionState();
      return false;
    }

    updateMuteButton();
    updateMediaSessionState();
    updateLocalMonitorGain();
    if (state.muted) {
      setParticipantSpeaking(state.peerId, false);
    }
    return true;
  }

  function updateMuteButton() {
    els.muteButton.classList.toggle("is-muted", state.muted);
    els.muteButton.setAttribute("aria-pressed", String(state.muted));
    els.muteButton.setAttribute("aria-label", state.muted ? "マイクをONにする" : "マイクをOFFにする");
    els.muteButtonText.textContent = state.muted ? "マイク OFF" : "マイク ON";
    els.pocketMuteHoldButton.classList.toggle("is-muted", state.muted);
    els.pocketMuteHoldButton.setAttribute("aria-pressed", String(state.muted));
    els.pocketMuteHoldButton.setAttribute("aria-label", state.muted ? "マイクをONにする" : "マイクをOFFにする");
    els.pocketMuteHoldText.textContent = state.muted ? "マイク OFF" : "マイク ON";
  }

  function updateSpeakerMuteButton() {
    els.speakerMuteButton.classList.toggle("is-muted", state.speakerMuted);
    els.speakerMuteButton.setAttribute("aria-pressed", String(state.speakerMuted));
    els.speakerMuteButton.setAttribute(
      "aria-label",
      state.speakerMuted ? "スピーカーをONにする" : "スピーカーをOFFにする",
    );
    els.speakerMuteButtonText.textContent = state.speakerMuted ? "スピーカー OFF" : "スピーカー ON";
    els.pocketSpeakerMuteHoldButton.classList.toggle("is-muted", state.speakerMuted);
    els.pocketSpeakerMuteHoldButton.setAttribute("aria-pressed", String(state.speakerMuted));
    els.pocketSpeakerMuteHoldButton.setAttribute(
      "aria-label",
      state.speakerMuted ? "スピーカーをONにする" : "スピーカーをOFFにする",
    );
    els.pocketSpeakerMuteHoldText.textContent = state.speakerMuted ? "スピーカー OFF" : "スピーカー ON";
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

  function setParticipantSuppression(peerId, suppressionPercent) {
    if (!peerId || !state.participants.has(peerId)) {
      return;
    }

    const participant = state.participants.get(peerId);
    const nextSuppression = Math.max(0, Math.min(100, Math.round(suppressionPercent)));
    const previousSuppression = participant.suppressionPercent || 0;

    if (Math.abs(previousSuppression - nextSuppression) < 3 && nextSuppression !== 0 && nextSuppression !== 100) {
      return;
    }

    participant.suppressionPercent = nextSuppression;
    state.participants.set(peerId, participant);
    renderParticipants();
  }

  function updateParticipantSpeakingFromFeature(peerId, feature, now) {
    if (!peerId || !state.participants.has(peerId)) {
      return;
    }

    const participant = state.participants.get(peerId);
    const isLoudEnough = Boolean(
      feature?.active
      && feature.energy >= PARTICIPANT_SPEAKING_ENERGY_THRESHOLD,
    );

    if (isLoudEnough) {
      participant.speakingUntil = now + PARTICIPANT_SPEAKING_HOLD_MS;
    }

    const nextSpeaking = (participant.speakingUntil || 0) > now;
    if (Boolean(participant.speaking) === nextSpeaking) {
      state.participants.set(peerId, participant);
      return;
    }

    participant.speaking = nextSpeaking;
    if (!nextSpeaking) {
      participant.speakingUntil = 0;
    }
    state.participants.set(peerId, participant);
    renderParticipants();
  }

  function setParticipantSpeaking(peerId, speaking) {
    if (!peerId || !state.participants.has(peerId)) {
      return;
    }

    const participant = state.participants.get(peerId);
    const nextSpeaking = Boolean(speaking);
    if (Boolean(participant.speaking) === nextSpeaking) {
      if (!nextSpeaking && participant.speakingUntil) {
        participant.speakingUntil = 0;
        state.participants.set(peerId, participant);
      }
      return;
    }

    participant.speaking = nextSpeaking;
    participant.speakingUntil = nextSpeaking ? performance.now() + PARTICIPANT_SPEAKING_HOLD_MS : 0;
    state.participants.set(peerId, participant);
    renderParticipants();
  }

  function clearParticipantSpeakingStates() {
    let changed = false;

    state.participants.forEach((participant) => {
      if (participant.speaking || participant.speakingUntil) {
        participant.speaking = false;
        participant.speakingUntil = 0;
        changed = true;
      }
    });

    if (changed) {
      renderParticipants();
    }
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
    const activeDisplayNameInput = state.displayNameEditMode
      && document.activeElement?.dataset.role === "display-name-input"
      ? {
        start: document.activeElement.selectionStart ?? state.displayNameDraft.length,
        end: document.activeElement.selectionEnd ?? state.displayNameDraft.length,
      }
      : null;
    const shouldPreserveDisplayNameEditor = state.displayNameEditMode
      && (state.displayNameFocusRequested || activeDisplayNameInput);

    if (shouldPreserveDisplayNameEditor) {
      state.suppressDisplayNameBlurCommit = true;
    }

    els.participantsList.innerHTML = "";
    [...state.participants.entries()].forEach(([peerId, participant]) => {
      const li = document.createElement("li");
      const row = document.createElement("div");
      const main = document.createElement("div");
      const status = document.createElement("span");
      const meter = document.createElement("span");
      const suppression = participant.suppressionPercent || 0;
      const isSpeaking = Boolean(participant.speaking);
      const isSelf = peerId === state.peerId;
      const isHost = peerId === state.hostId;

      row.className = "participant-row";
      main.className = "participant-main";
      status.className = "participant-state";
      meter.className = "participant-suppression";
      li.classList.toggle("is-self", isSelf);
      li.classList.toggle("is-host", isHost);
      li.classList.toggle("is-suppressed", suppression >= 10);
      li.classList.toggle("is-speaking", isSpeaking);
      if (isSpeaking && suppression >= 10) {
        status.textContent = `発話中 / 抑制 ${suppression}%`;
      } else if (isSpeaking) {
        status.textContent = "発話中";
      } else {
        status.textContent = suppression >= 10 ? `近接抑制 ${suppression}%` : participant.state || "接続中";
      }
      meter.style.setProperty("--suppression", `${suppression}%`);

      if (isSelf && state.displayNameEditMode) {
        main.append(createDisplayNameEditInput(peerId), createDisplayNameEditButton({ editing: true }));
      } else {
        main.append(createParticipantLabel(participant.label || shortId(peerId)));
        if (isSelf) {
          main.append(createDisplayNameEditButton());
        }
      }
      if (isHost) {
        main.append(createParticipantHostBadge());
      }

      row.append(main, status);
      li.append(row);
      if (suppression >= 10) {
        li.append(meter);
      }
      els.participantsList.append(li);
    });

    if (state.displayNameEditMode && (state.displayNameFocusRequested || activeDisplayNameInput)) {
      const selection = activeDisplayNameInput || {
        start: state.displayNameDraft.length,
        end: state.displayNameDraft.length,
      };
      const input = els.participantsList.querySelector('[data-role="display-name-input"]');
      if (input) {
        window.requestAnimationFrame(() => {
          input.focus();
          input.setSelectionRange(selection.start, selection.end);
          state.suppressDisplayNameBlurCommit = false;
        });
      } else {
        state.suppressDisplayNameBlurCommit = false;
      }
      state.displayNameFocusRequested = false;
      return;
    }

    state.suppressDisplayNameBlurCommit = false;
  }

  function createParticipantLabel(label) {
    const id = document.createElement("span");
    id.className = "participant-id";
    id.textContent = label;
    return id;
  }

  function createParticipantHostBadge() {
    const badge = document.createElement("span");
    badge.className = "participant-host-badge";
    badge.title = "現在の参加受付担当";
    badge.textContent = "ホスト";
    return badge;
  }

  function createDisplayNameEditInput(peerId) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "participant-name-input";
    input.dataset.role = "display-name-input";
    input.maxLength = 32;
    input.autocomplete = "nickname";
    input.spellcheck = false;
    input.placeholder = shortId(peerId) || "自分";
    input.value = state.displayNameDraft;
    input.addEventListener("input", onDisplayNameDraftInput);
    input.addEventListener("blur", onDisplayNameInputBlur);
    input.addEventListener("keydown", onDisplayNameInputKeydown);
    return input;
  }

  function createDisplayNameEditButton({ editing = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "participant-edit-button";
    button.setAttribute("aria-label", editing ? "表示名を確定" : "表示名を変更");
    button.title = editing ? "表示名を確定" : "表示名を変更";
    button.innerHTML = editing
      ? `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
          <path d="M20 6 9 17l-5-5"></path>
        </svg>
      `
      : `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>
        </svg>
      `;
    button.addEventListener("click", editing ? commitDisplayNameEdit : startDisplayNameEdit);
    return button;
  }

  function removeParticipant(peerId, { broadcast, playTone = true }) {
    if (!peerId || peerId === state.peerId) {
      return;
    }

    cancelMediaReconnect(peerId);
    const hadParticipant = state.participants.delete(peerId);
    if (playTone && hadParticipant && state.mode === "room") {
      playParticipantTone("leave");
    }
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
      state.failedHostIds.add(peerId);
      state.suppressHostCloseNotice = true;
      if (state.hostConnection) {
        state.hostConnection.close();
        state.hostConnection = null;
      }
    }
    removeParticipant(peerId, { broadcast: false });

    if (wasJoinTarget) {
      electRoomCoordinator(peerId).catch(handleFatalError);
    }
  }

  function pickNextRoomCoordinator(excludedPeerIds = []) {
    const excluded = excludedPeerIds instanceof Set
      ? excludedPeerIds
      : new Set(Array.isArray(excludedPeerIds) ? excludedPeerIds : [excludedPeerIds]);
    const peerIds = new Set([...state.participants.keys(), state.peerId].filter(isValidPeerId));
    return [...peerIds]
      .filter((peerId) => !excluded.has(peerId))
      .sort()[0] || state.peerId;
  }

  async function electRoomCoordinator(excludedPeerId = "") {
    if (state.mode !== "room" || !state.peerId) {
      return;
    }

    const excludedPeerIds = new Set(state.failedHostIds);
    if (isValidPeerId(excludedPeerId)) {
      excludedPeerIds.add(excludedPeerId);
    }

    const nextHostId = pickNextRoomCoordinator(excludedPeerIds);
    state.hostId = nextHostId;
    state.roomEstablished = true;
    setRoomUrl(state.roomId);
    renderRoomQr().catch(() => undefined);

    if (nextHostId === state.peerId) {
      await becomeRoomCoordinator();
    } else {
      followRoomCoordinator(nextHostId);
    }

    updateRoomStatus();
    renderParticipants();
  }

  async function becomeRoomCoordinator() {
    state.role = "host";
    state.hostId = state.peerId;
    state.roomEstablished = true;
    state.roomGeneration = Math.max(1, state.roomGeneration + 1);
    cancelHostReconnect();
    resetHostReconnectState();

    if (state.hostConnection) {
      state.suppressHostCloseNotice = true;
      state.hostConnection.close();
      state.hostConnection = null;
    }

    try {
      await ensureRoomServicePeer();
      updateConnectionBadge("接続中");
      broadcastRoster();
    } catch {
      showToast("参加受付の取得を待っています。");
      scheduleRoomServicePeerRecover();
    }
  }

  function followRoomCoordinator(nextHostId) {
    if (!isValidPeerId(nextHostId)) {
      return;
    }

    state.role = "guest";
    state.hostId = nextHostId;
    closeRoomServicePeer();
    cancelRoomServicePeerRecover();
    resetHostReconnectState();
    showToast("新しい参加受付に接続しています。");
    scheduleHostReconnect(ROOM_SERVICE_RETRY_MS);
  }

  function relinquishRoomCoordinator(nextHostId, { connect = false } = {}) {
    if (isValidPeerId(nextHostId)) {
      state.hostId = nextHostId;
    }

    if (state.role === "host") {
      state.role = "guest";
      closeRoomServicePeer();
      cancelRoomServicePeerRecover();
      closeCoordinatorDataConnections();
    }

    if (connect && state.mode === "room" && state.hostId !== state.peerId) {
      cancelHostReconnect();
      scheduleHostReconnect(0);
    }
  }

  function closeCoordinatorDataConnections() {
    state.dataConnections.forEach((connection) => {
      connection.__skipParticipantRemove = true;
      connection.close();
    });
    state.dataConnections.clear();
  }

  function shouldInitiateMediaReconnect(peerId) {
    if (!state.peerId || !peerId) {
      return false;
    }
    return state.peerId.localeCompare(peerId) < 0;
  }

  function scheduleMediaReconnect(peerId, delayMs = MEDIA_RECONNECT_RETRY_MS) {
    cancelMediaReconnect(peerId);
    if (
      state.mode !== "room"
      || state.isLeaving
      || !state.peer
      || !state.localStream
      || !state.participants.has(peerId)
      || state.mediaConnections.has(peerId)
      || !shouldInitiateMediaReconnect(peerId)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      state.mediaReconnectTimers.delete(peerId);
      if (
        state.mode !== "room"
        || state.isLeaving
        || !state.participants.has(peerId)
        || state.mediaConnections.has(peerId)
        || !shouldInitiateMediaReconnect(peerId)
      ) {
        return;
      }

      callPeer(peerId)
        .then(() => undefined)
        .catch(() => {
          scheduleMediaReconnect(peerId);
        });
    }, delayMs);

    state.mediaReconnectTimers.set(peerId, timer);
  }

  function cancelMediaReconnect(peerId) {
    const timer = state.mediaReconnectTimers.get(peerId);
    if (timer) {
      window.clearTimeout(timer);
      state.mediaReconnectTimers.delete(peerId);
    }
  }

  function scheduleMissingMediaReconnects() {
    [...state.participants.keys()].forEach((peerId) => {
      if (peerId !== state.peerId && !state.mediaConnections.has(peerId)) {
        scheduleMediaReconnect(peerId, 0);
      }
    });
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
      sendData(state.hostConnection, {
        type: "heartbeat",
        peerId: state.peerId,
        displayName: state.displayName,
      });
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
      generation: state.roomGeneration,
      peers: [...state.participants.keys()],
      names: serializeParticipantNames(),
      locations: serializeParticipantLocations(),
    });
  }

  function applyRoster(message) {
    if (!Array.isArray(message.peers)) {
      return;
    }

    if (!applyCoordinatorState(message)) {
      return;
    }

    const rosterPeerIds = new Set(message.peers.filter(isValidPeerId));
    const now = Date.now();

    if (isValidPeerId(message.roomId)) {
      state.roomId = message.roomId;
      renderRoomQr().catch(() => undefined);
      setRoomUrl(message.roomId);
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

    applyParticipantNames(message.names);
    applyParticipantLocations(message.locations);

    [...state.participants.keys()].forEach((peerId) => {
      if (peerId !== state.peerId && !rosterPeerIds.has(peerId)) {
        removeParticipant(peerId, { broadcast: false, playTone: false });
      }
    });

    updateRoomStatus();
    renderParticipants();
  }

  async function ensureAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("このブラウザは音声処理に対応していません。");
    }

    if (!state.audioContext) {
      try {
        state.audioContext = new AudioContextClass({ latencyHint: "interactive" });
      } catch {
        state.audioContext = new AudioContextClass();
      }
    }

    if (state.audioContext.state === "suspended") {
      await state.audioContext.resume();
    }

    return state.audioContext;
  }

  async function playParticipantTone(kind) {
    const sequence = kind === "join" ? PARTICIPANT_JOIN_TONE : PARTICIPANT_LEAVE_TONE;

    try {
      const audioContext = await ensureAudioContext();
      let startTime = audioContext.currentTime + 0.01;

      sequence.forEach((note) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = kind === "join" ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(note.frequency, startTime);
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.05, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + note.duration);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + note.duration + 0.03);
        oscillator.addEventListener("ended", () => {
          oscillator.disconnect();
          gain.disconnect();
        }, { once: true });

        startTime += note.duration * 0.7;
      });
    } catch {
      // Skip tones when the browser blocks AudioContext output.
    }
  }

  async function setupLocalAudioAnalysis() {
    if (!state.localStream) {
      return;
    }

    try {
      const audioContext = await ensureAudioContext();
      disconnectLocalAudioAnalysis();

      const source = audioContext.createMediaStreamSource(state.localStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      connectLocalMonitor(source, audioContext);

      state.localAudioSource = source;
      state.localAnalyser = analyser;
      state.localFrequencyData = new Uint8Array(analyser.frequencyBinCount);
      state.localVad = createVadState();
      state.localFeatureHistory = [];
    } catch {
      state.localAnalyser = null;
      state.localFrequencyData = null;
      state.localVad = null;
    }
  }

  function connectLocalMonitor(source, audioContext) {
    disconnectLocalMonitor();

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(state.muted ? 0 : LOCAL_MONITOR_GAIN, audioContext.currentTime);
    source.connect(gain);
    gain.connect(audioContext.destination);
    state.localMonitorGain = gain;
  }

  function updateLocalMonitorGain() {
    if (!state.localMonitorGain || !state.audioContext) {
      return;
    }

    const nextGain = state.muted ? 0 : LOCAL_MONITOR_GAIN;
    const now = state.audioContext.currentTime;
    state.localMonitorGain.gain.cancelScheduledValues(now);
    state.localMonitorGain.gain.setTargetAtTime(nextGain, now, 0.012);
  }

  function disconnectLocalMonitor() {
    if (!state.localMonitorGain) {
      return;
    }

    try {
      state.localMonitorGain.disconnect();
    } catch {
      // Already disconnected.
    }
    state.localMonitorGain = null;
  }

  function disconnectLocalAudioAnalysis() {
    disconnectLocalMonitor();

    if (state.localAudioSource) {
      try {
        state.localAudioSource.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    state.localAudioSource = null;
    state.localAnalyser = null;
    state.localFrequencyData = null;
    state.localVad = null;
    state.localFeatureHistory = [];
    setParticipantSpeaking(state.peerId, false);
  }

  function stopSilentAudioTrack() {
    if (state.silentAudioSource) {
      try {
        state.silentAudioSource.stop();
      } catch {
        // Already stopped.
      }
      try {
        state.silentAudioSource.disconnect();
      } catch {
        // Already disconnected.
      }
    }

    if (state.silentAudioGain) {
      try {
        state.silentAudioGain.disconnect();
      } catch {
        // Already disconnected.
      }
    }

    state.silentAudioDestination?.stream.getTracks().forEach((track) => track.stop());
    state.silentAudioSource = null;
    state.silentAudioGain = null;
    state.silentAudioDestination = null;
    state.silentAudioTrack = null;
  }

  function startLocationMonitor() {
    stopLocationMonitor();

    if (!navigator.geolocation || !window.isSecureContext) {
      return;
    }

    try {
      state.locationWatchId = navigator.geolocation.watchPosition(
        (position) => handleLocalPosition(position),
        (error) => handleLocationError(error),
        {
          enableHighAccuracy: false,
          maximumAge: LOCATION_WATCH_MAXIMUM_AGE_MS,
          timeout: LOCATION_WATCH_TIMEOUT_MS,
        },
      );
    } catch {
      state.locationWatchId = null;
    }
  }

  function stopLocationMonitor() {
    if (state.locationWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.locationWatchId);
    }
    state.locationWatchId = null;
  }

  function handleLocalPosition(position) {
    const sharedLocation = createSharedLocation(position);
    if (!sharedLocation || !state.peerId) {
      return;
    }

    setParticipantLocation(state.peerId, sharedLocation);
    shareLocalLocation(sharedLocation);
  }

  function handleLocationError(error) {
    if (
      error?.code === error?.PERMISSION_DENIED
      && !state.locationNoticeShown
      && state.mode === "room"
    ) {
      stopLocationMonitor();
      state.locationNoticeShown = true;
      showToast("位置情報が使えないため、遠距離判定は音声のみになります。");
    }
  }

  function shareLocalLocation(location = getParticipantLocation(state.peerId)) {
    if (!location || state.role !== "guest" || !state.hostConnection?.open) {
      return;
    }

    sendData(state.hostConnection, {
      type: "location-update",
      peerId: state.peerId,
      displayName: state.displayName,
      location,
    });
  }

  function startDisplayNameEdit() {
    if (state.displayNameEditMode) {
      return;
    }
    state.displayNameDraft = state.displayName;
    state.displayNameEditMode = true;
    state.displayNameFocusRequested = true;
    renderParticipants();
  }

  function onDisplayNameDraftInput(event) {
    const nextDraft = normalizeDisplayNameDraft(event.target.value);
    state.displayNameDraft = nextDraft;
    if (event.target.value !== nextDraft) {
      event.target.value = nextDraft;
    }
  }

  function onDisplayNameInputKeydown(event) {
    if (event.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitDisplayNameEdit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelDisplayNameEdit();
    }
  }

  function onDisplayNameInputBlur() {
    if (state.suppressDisplayNameBlurCommit) {
      return;
    }
    commitDisplayNameEdit();
  }

  function commitDisplayNameEdit() {
    if (!state.displayNameEditMode) {
      return;
    }
    state.displayNameEditMode = false;
    state.displayNameFocusRequested = false;
    state.suppressDisplayNameBlurCommit = false;
    if (!setDisplayName(state.displayNameDraft)) {
      renderParticipants();
    }
  }

  function cancelDisplayNameEdit() {
    if (!state.displayNameEditMode) {
      return;
    }
    state.displayNameDraft = state.displayName;
    state.displayNameEditMode = false;
    state.displayNameFocusRequested = false;
    state.suppressDisplayNameBlurCommit = false;
    renderParticipants();
  }

  function setDisplayName(nextDisplayName) {
    const sanitized = sanitizeDisplayName(nextDisplayName);
    if (sanitized === state.displayName) {
      return false;
    }
    state.displayName = sanitized;
    updateLocalParticipantLabel();
    syncDisplayName();
    return true;
  }

  function updateLocalParticipantLabel() {
    if (!state.peerId || !state.participants.has(state.peerId)) {
      return;
    }
    const selfParticipant = state.participants.get(state.peerId) || {};
    selfParticipant.label = getLocalParticipantLabel();
    state.participants.set(state.peerId, selfParticipant);
    renderParticipants();
  }

  function syncDisplayName() {
    if (state.mode !== "room" || !state.peerId) {
      return;
    }
    if (state.role === "host") {
      broadcastRoster();
      return;
    }
    sendData(state.hostConnection, {
      type: "name-update",
      peerId: state.peerId,
      displayName: state.displayName,
    });
  }

  function getLocalParticipantLabel() {
    return formatParticipantLabel(state.displayName, state.peerId);
  }

  function formatParticipantLabel(displayName, peerId) {
    const sanitized = sanitizeDisplayName(displayName);
    if (sanitized) {
      return sanitized;
    }
    return shortId(peerId) || "自分";
  }

  function sanitizeDisplayName(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim().slice(0, 32);
  }

  function normalizeDisplayNameDraft(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.slice(0, 32);
  }

  function maybeUpdateParticipantName(peerId, displayName) {
    if (!peerId || peerId === state.peerId || !state.participants.has(peerId)) {
      return;
    }
    const participant = state.participants.get(peerId);
    const nextLabel = formatParticipantLabel(displayName, peerId);
    if (participant.label === nextLabel) {
      return;
    }
    participant.label = nextLabel;
    state.participants.set(peerId, participant);
    renderParticipants();
  }

  function serializeParticipantNames() {
    return Object.fromEntries(
      [...state.participants.entries()].map(([peerId, participant]) => [
        peerId,
        participant.label || shortId(peerId),
      ]),
    );
  }

  function applyParticipantNames(names) {
    if (!names || typeof names !== "object") {
      return;
    }

    Object.entries(names).forEach(([peerId, label]) => {
      if (!isValidPeerId(peerId) || peerId === state.peerId || !state.participants.has(peerId)) {
        return;
      }
      const participant = state.participants.get(peerId);
      participant.label = formatParticipantLabel(label, peerId);
      state.participants.set(peerId, participant);
    });
  }

  function createSharedLocation(position) {
    const coords = position?.coords;
    if (!coords) {
      return null;
    }

    return normalizeSharedLocation({
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
      timestamp: position.timestamp || Date.now(),
    });
  }

  function normalizeSharedLocation(location) {
    if (!location || typeof location !== "object") {
      return null;
    }

    const lat = Number(location.lat);
    const lng = Number(location.lng);
    const accuracy = Number(location.accuracy);
    const timestamp = Number(location.timestamp || Date.now());

    if (
      !Number.isFinite(lat)
      || !Number.isFinite(lng)
      || !Number.isFinite(accuracy)
      || !Number.isFinite(timestamp)
      || lat < -90
      || lat > 90
      || lng < -180
      || lng > 180
      || accuracy < 0
    ) {
      return null;
    }

    return {
      lat: roundNumber(lat, 6),
      lng: roundNumber(lng, 6),
      accuracy: roundNumber(accuracy, 1),
      timestamp,
    };
  }

  function roundNumber(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function getParticipantLocation(peerId) {
    return state.participants.get(peerId)?.location || null;
  }

  function setParticipantLocation(peerId, location) {
    if (!peerId || !state.participants.has(peerId)) {
      return;
    }

    const participant = state.participants.get(peerId);
    participant.location = normalizeSharedLocation(location);
    state.participants.set(peerId, participant);
  }

  function serializeParticipantLocations() {
    return Object.fromEntries(
      [...state.participants.entries()].map(([peerId, participant]) => [peerId, participant.location || null]),
    );
  }

  function applyParticipantLocations(locations) {
    if (!locations || typeof locations !== "object") {
      return;
    }

    Object.entries(locations).forEach(([peerId, location]) => {
      if (peerId === state.peerId || !state.participants.has(peerId)) {
        return;
      }

      const participant = state.participants.get(peerId);
      participant.location = normalizeSharedLocation(location);
      state.participants.set(peerId, participant);
    });
  }

  function evaluateLocationGate(peerId) {
    const localLocation = getParticipantLocation(state.peerId);
    const remoteLocation = getParticipantLocation(peerId);

    if (!isFreshUsableLocation(localLocation) || !isFreshUsableLocation(remoteLocation)) {
      return { skip: false };
    }

    const distance = calculateDistanceMeters(localLocation, remoteLocation);
    const minPossibleDistance = Math.max(0, distance - localLocation.accuracy - remoteLocation.accuracy);

    return {
      skip: minPossibleDistance >= LOCATION_FAR_SKIP_DISTANCE_M,
      distance,
      minPossibleDistance,
    };
  }

  function isFreshUsableLocation(location) {
    return Boolean(
      location
      && Number.isFinite(location.lat)
      && Number.isFinite(location.lng)
      && Number.isFinite(location.accuracy)
      && Number.isFinite(location.timestamp)
      && location.accuracy <= LOCATION_MAX_ACCURACY_M
      && Date.now() - location.timestamp <= LOCATION_STALE_MS,
    );
  }

  function calculateDistanceMeters(left, right) {
    const earthRadiusM = 6371000;
    const lat1 = degreesToRadians(left.lat);
    const lat2 = degreesToRadians(right.lat);
    const deltaLat = degreesToRadians(right.lat - left.lat);
    const deltaLng = degreesToRadians(right.lng - left.lng);
    const sinLat = Math.sin(deltaLat / 2);
    const sinLng = Math.sin(deltaLng / 2);
    const a = sinLat * sinLat
      + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  function degreesToRadians(value) {
    return (value * Math.PI) / 180;
  }

  function startProximityMonitor() {
    stopProximityMonitor();
    state.proximityTimer = window.setInterval(runProximityTick, PROXIMITY_INTERVAL_MS);
  }

  function stopProximityMonitor() {
    if (state.proximityTimer) {
      window.clearInterval(state.proximityTimer);
      state.proximityTimer = null;
    }
  }

  function runProximityTick() {
    if (state.mode !== "room" || !state.localAnalyser || !state.audioContext || state.audioContext.state !== "running") {
      clearParticipantSpeakingStates();
      return;
    }

    const now = performance.now();
    const localFeature = readAudioFeature(state.localAnalyser, state.localFrequencyData, state.localVad);
    updateParticipantSpeakingFromFeature(state.peerId, state.muted ? null : localFeature, now);
    if (localFeature.active) {
      state.localFeatureHistory.push({ ...localFeature, time: now });
    }
    state.localFeatureHistory = state.localFeatureHistory.filter((feature) => now - feature.time <= PROXIMITY_HISTORY_MS);

    state.remoteProcessors.forEach((processor, peerId) => {
      const remoteFeature = readAudioFeature(processor.analyser, processor.frequencyData, processor.vad);
      updateParticipantSpeakingFromFeature(peerId, remoteFeature, now);

      const locationGate = evaluateLocationGate(peerId);
      if (locationGate.skip) {
        releaseRemoteSuppression(peerId, processor);
        return;
      }

      const proximityResult = estimateProximity(remoteFeature, now);
      updateRemoteSuppression(peerId, processor, proximityResult);
    });
  }

  function createVadState() {
    return {
      noiseFloor: VAD_INITIAL_NOISE_FLOOR,
      hangover: 0,
    };
  }

  function readAudioFeature(analyser, frequencyData, vadState) {
    analyser.getByteFrequencyData(frequencyData);

    const sampleRate = state.audioContext?.sampleRate || 48000;
    const nyquist = sampleRate / 2;
    const bands = [
      averageFrequencyRange(frequencyData, nyquist, 120, 250),
      averageFrequencyRange(frequencyData, nyquist, 250, 500),
      averageFrequencyRange(frequencyData, nyquist, 500, 1000),
      averageFrequencyRange(frequencyData, nyquist, 1000, 2000),
      averageFrequencyRange(frequencyData, nyquist, 2000, 3400),
      averageFrequencyRange(frequencyData, nyquist, 3400, 5200),
    ];
    const voiceEnergy = bands.slice(0, 5).reduce((sum, value) => sum + value, 0) / 5;
    const fullEnergy = averageFrequencyRange(frequencyData, nyquist, 80, 7000);
    const voiceRatio = voiceEnergy / (fullEnergy || 1);
    const active = detectVoice(vadState, voiceEnergy, voiceRatio);
    const norm = Math.hypot(...bands) || 1;

    return {
      active,
      energy: voiceEnergy,
      voiceRatio,
      bands: bands.map((value) => value / norm),
    };
  }

  function detectVoice(vadState, voiceEnergy, voiceRatio) {
    if (!vadState) {
      return voiceEnergy > VAD_MIN_VOICE_ENERGY && voiceRatio >= VAD_MIN_VOICE_RATIO;
    }

    const noiseFloor = vadState.noiseFloor ?? VAD_INITIAL_NOISE_FLOOR;
    const voiceThreshold = Math.max(
      VAD_MIN_VOICE_ENERGY,
      noiseFloor * VAD_NOISE_MULTIPLIER + VAD_NOISE_OFFSET,
    );
    const rawActive = voiceEnergy >= voiceThreshold && voiceRatio >= VAD_MIN_VOICE_RATIO;
    const hangoverActive = vadState.hangover > 0 && voiceEnergy >= voiceThreshold * 0.65;
    const active = rawActive || hangoverActive;

    if (rawActive) {
      vadState.hangover = VAD_HANGOVER_TICKS;
    } else if (vadState.hangover > 0) {
      vadState.hangover -= 1;
    }

    if (active) {
      vadState.noiseFloor = noiseFloor * 0.995 + Math.min(voiceEnergy, noiseFloor) * 0.005;
    } else {
      vadState.noiseFloor = noiseFloor * 0.92 + Math.min(voiceEnergy, 0.18) * 0.08;
    }

    return active;
  }

  function averageFrequencyRange(frequencyData, nyquist, minFrequency, maxFrequency) {
    const start = Math.max(0, Math.floor((minFrequency / nyquist) * frequencyData.length));
    const end = Math.min(frequencyData.length - 1, Math.ceil((maxFrequency / nyquist) * frequencyData.length));
    let total = 0;
    let count = 0;

    for (let index = start; index <= end; index += 1) {
      total += frequencyData[index] / 255;
      count += 1;
    }

    return count > 0 ? total / count : 0;
  }

  function estimateProximity(remoteFeature, now) {
    if (!remoteFeature.active) {
      return null;
    }

    let bestSimilarity = 0;
    let candidateCount = 0;
    state.localFeatureHistory.forEach((localFeature) => {
      const lag = now - localFeature.time;
      if (lag < PROXIMITY_MIN_LAG_MS || lag > PROXIMITY_MAX_LAG_MS) {
        return;
      }

      candidateCount += 1;
      const similarity = cosineSimilarity(localFeature.bands, remoteFeature.bands);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
      }
    });

    const score = candidateCount > 0 ? clamp((bestSimilarity - 0.72) / 0.2, 0, 1) : 0;
    return {
      score,
      detected: score >= PROXIMITY_SCORE_THRESHOLD,
      candidateCount,
    };
  }

  function cosineSimilarity(left, right) {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }

    return dot / ((Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) || 1);
  }

  function updateRemoteSuppression(peerId, processor, proximityResult) {
    const now = performance.now();
    processor.proximityDecisions = processor.proximityDecisions.filter(
      (decision) => now - decision.time <= PROXIMITY_DECISION_WINDOW_MS,
    );
    const hadRecentVoiceDecision = processor.proximityDecisions.length > 0;

    if (proximityResult) {
      processor.proximityDecisions.push({
        time: now,
        score: proximityResult.score,
        detected: proximityResult.detected,
        candidateCount: proximityResult.candidateCount,
      });
    }

    if (proximityResult && !hadRecentVoiceDecision) {
      processor.lastLevelDecisionAt = now;
    } else if (
      proximityResult
      && now - processor.lastLevelDecisionAt >= PROXIMITY_DECISION_INTERVAL_MS
      && processor.proximityDecisions.length >= PROXIMITY_MIN_VOICE_DECISIONS
    ) {
      processor.lastLevelDecisionAt = now;
      updateSuppressionLevel(processor);
    }

    applyRemoteGain(peerId, processor);
  }

  function releaseRemoteSuppression(peerId, processor) {
    processor.proximityDecisions = [];
    processor.lastLevelDecisionAt = 0;
    processor.levelIndex = 0;
    processor.targetGain = 1;
    applyRemoteGain(peerId, processor);
  }

  function applyRemoteGain(peerId, processor) {
    const gainStep = 0.16;
    if (Math.abs(processor.currentGain - processor.targetGain) <= gainStep) {
      processor.currentGain = processor.targetGain;
    } else {
      processor.currentGain += processor.currentGain < processor.targetGain ? gainStep : -gainStep;
    }
    processor.currentGain = clamp(processor.currentGain, PROXIMITY_MIN_GAIN, 1);

    applyRemoteOutputVolume(peerId, processor.currentGain);

    const suppressionPercent = Math.round((1 - processor.currentGain) * 100);
    if (Math.abs((processor.suppressionPercent || 0) - suppressionPercent) >= 3) {
      processor.suppressionPercent = suppressionPercent;
      setParticipantSuppression(peerId, suppressionPercent);
    }
  }

  function applyRemoteOutputVolume(peerId, baseVolume) {
    const audio = state.remoteAudios.get(peerId);
    if (!audio) {
      return;
    }

    const effectiveBaseVolume = Number.isFinite(baseVolume)
      ? baseVolume
      : state.remoteProcessors.get(peerId)?.currentGain ?? 1;
    audio.volume = state.speakerMuted ? 0 : clamp(effectiveBaseVolume, 0, 1);
  }

  function applyAllRemoteOutputVolumes() {
    state.remoteAudios.forEach((_audio, peerId) => {
      applyRemoteOutputVolume(peerId);
    });
  }

  function updateSuppressionLevel(processor) {
    const decisions = processor.proximityDecisions;
    if (decisions.length < PROXIMITY_MIN_VOICE_DECISIONS) {
      return;
    }

    const detectedCount = decisions.filter((decision) => decision.detected).length;
    const detectedRatio = detectedCount / decisions.length;
    const averageScore = decisions.reduce((sum, decision) => sum + decision.score, 0) / decisions.length;
    const seemsNear = detectedRatio >= 0.5 || averageScore >= 0.55;

    if (seemsNear) {
      processor.levelIndex = Math.min(PROXIMITY_GAIN_LEVELS.length - 1, processor.levelIndex + 1);
    } else {
      processor.levelIndex = Math.max(0, processor.levelIndex - 1);
    }

    processor.targetGain = PROXIMITY_GAIN_LEVELS[processor.levelIndex];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function broadcastHostMessage(message, exceptPeerId = "") {
    const outgoingMessage = {
      ...message,
      roomId: state.roomId,
      hostId: state.peerId,
      generation: state.roomGeneration,
    };
    state.dataConnections.forEach((connection, peerId) => {
      if (peerId !== exceptPeerId) {
        sendData(connection, outgoingMessage);
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
    stopProximityMonitor();
    stopLocationMonitor();
    releaseWakeLock();
    cancelHostReconnect();
    cancelParticipantPeerReconnect();
    cancelRoomServicePeerRecover();
    disconnectLocalAudioAnalysis();
    stopSilentAudioTrack();

    state.dataConnections.forEach((connection) => connection.close());
    state.dataConnections.clear();

    if (state.hostConnection) {
      state.hostConnection.close();
      state.hostConnection = null;
    }

    closeRoomServicePeer();
    state.roomPeerPromise = null;

    state.mediaConnections.forEach((connection) => connection.close());
    state.mediaConnections.clear();
    state.mediaReconnectTimers.forEach((timer) => window.clearTimeout(timer));
    state.mediaReconnectTimers.clear();

    [...state.remoteAudios.keys()].forEach((peerId) => detachRemoteAudio(peerId));
    state.remoteProcessors.clear();

    if (state.audioContext) {
      state.audioContext.close().catch(() => undefined);
      state.audioContext = null;
    }

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
    state.speakerMuted = false;
    state.lastHeadsetActionAt = 0;
    resetHostReconnectState();
    state.locationNoticeShown = false;
    state.roomEstablished = false;
    state.roomGeneration = 0;
    state.participants.clear();
    state.displayNameDraft = "";
    state.displayNameEditMode = false;
    state.displayNameFocusRequested = false;
    state.suppressDisplayNameBlurCommit = false;
    updateMuteButton();
    updateSpeakerMuteButton();
    updateMediaSessionState();
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
    [els.unlockHoldButton, els.pocketMuteHoldButton, els.pocketSpeakerMuteHoldButton].forEach((button) => {
      button.style.setProperty("--pocket-hold-duration", `${UNLOCK_HOLD_MS}ms`);
    });
    els.pocketOverlay.classList.remove("hidden");
    requestWakeLock().catch(() => undefined);
  }

  function disablePocketLock() {
    els.pocketOverlay.classList.add("hidden");
    cancelUnlockHold();
    cancelPocketMuteHold();
    cancelPocketSpeakerMuteHold();
  }

  function beginUnlockHold(event) {
    event?.preventDefault();
    cancelUnlockHold();
    beginPocketHold(els.unlockHoldButton);
    state.unlockTimer = window.setTimeout(() => {
      completePocketHold(els.unlockHoldButton);
      disablePocketLock();
      notifyPocketAction();
      showToast("ポケットロックを解除しました。");
    }, UNLOCK_HOLD_MS);
  }

  function cancelUnlockHold(event) {
    event?.preventDefault();
    cancelPocketHold(els.unlockHoldButton);
    if (state.unlockTimer) {
      window.clearTimeout(state.unlockTimer);
      state.unlockTimer = null;
    }
  }

  function beginPocketMuteHold(event) {
    event?.preventDefault();
    cancelPocketMuteHold();
    beginPocketHold(els.pocketMuteHoldButton);
    state.pocketMuteTimer = window.setTimeout(() => {
      state.pocketMuteTimer = null;
      toggleMute()
        .then((changed) => {
          completePocketHold(els.pocketMuteHoldButton);
          if (changed) {
            notifyPocketAction();
            showToast(state.muted ? "マイクをOFFにしました。" : "マイクをONにしました。");
          }
        })
        .catch((error) => {
          completePocketHold(els.pocketMuteHoldButton);
          handleFatalError(error);
        });
    }, UNLOCK_HOLD_MS);
  }

  function cancelPocketMuteHold(event) {
    event?.preventDefault();
    cancelPocketHold(els.pocketMuteHoldButton);
    if (state.pocketMuteTimer) {
      window.clearTimeout(state.pocketMuteTimer);
      state.pocketMuteTimer = null;
    }
  }

  function beginPocketSpeakerMuteHold(event) {
    event?.preventDefault();
    cancelPocketSpeakerMuteHold();
    beginPocketHold(els.pocketSpeakerMuteHoldButton);
    state.pocketSpeakerMuteTimer = window.setTimeout(() => {
      state.pocketSpeakerMuteTimer = null;
      const changed = toggleSpeakerMute();
      completePocketHold(els.pocketSpeakerMuteHoldButton);
      if (changed) {
        notifyPocketAction();
        showToast(state.speakerMuted ? "スピーカーをOFFにしました。" : "スピーカーをONにしました。");
      }
    }, UNLOCK_HOLD_MS);
  }

  function cancelPocketSpeakerMuteHold(event) {
    event?.preventDefault();
    cancelPocketHold(els.pocketSpeakerMuteHoldButton);
    if (state.pocketSpeakerMuteTimer) {
      window.clearTimeout(state.pocketSpeakerMuteTimer);
      state.pocketSpeakerMuteTimer = null;
    }
  }

  function beginPocketHold(button) {
    button.classList.remove("is-holding");
    void button.offsetWidth;
    button.classList.add("is-holding");
  }

  function cancelPocketHold(button) {
    button.classList.remove("is-holding");
  }

  function completePocketHold(button) {
    button.classList.remove("is-holding");
  }

  function notifyPocketAction() {
    if (navigator.vibrate) {
      navigator.vibrate(18);
    }
  }

  async function unlockRemoteAudio() {
    if (state.audioContext?.state === "suspended") {
      await state.audioContext.resume().catch(() => undefined);
    }
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
    if (isPendingHostReconnectError(error)) {
      handleHostReconnectFailure(error);
      return;
    }

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
