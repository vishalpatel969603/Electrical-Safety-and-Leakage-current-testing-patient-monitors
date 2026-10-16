/**
 * ============================================================================
 * ELECTRICAL SAFETY AND LEAKAGE CURRENT TESTING IN PATIENT MONITORS
 * 3D Virtual Biomedical Laboratory Application
 * 
 * Technology: HTML5, CSS3, Vanilla JavaScript, Three.js (r128)
 * Designed for: B.Tech Biomedical Engineering / Electrical Engineering Mini-Project
 * ============================================================================
 */

(function () {
  'use strict';

  /* ==========================================================================
     GLOBAL STATE & CONFIGURATION
     ========================================================================== */
  const AppState = {
    // Device Under Test (DUT - Patient Monitor) State
    dutPower: true,
    leadsConnected: true,
    heartRate: 72,
    spO2: 98,
    respRate: 16,

    // Safety Analyzer State
    testRunning: false,
    testProgress: 0, // 0 to 100%
    selectedTestKey: 'earth_nc',
    mainsPolarity: 'normal', // 'normal' | 'reverse'
    peSwitch: 'closed', // 'closed' (NC) | 'open' (SFC)
    simulatedCurrent: 0.0, // Microamperes (µA)
    lastStableReading: null,
    testIntervalId: null,
    cableGlowActive: true,

    // Threshold Configuration State (Section 7 Compliance)
    thresholdConfigured: false,
    configuredLimit: 100.0, // µA
    standardPreset: 'custom',
    lastVerdict: 'NOT CONFIGURED',

    // Camera & Scene Management
    cameraView: 'overview',
    cameraTransitioning: false,
    camTargetPos: null,
    camTargetLookAt: null,

    // Test History
    historyKey: 'biomed_leakage_history_v1',
    historyRecords: []
  };

  /* Test Presets and Theoretical Limits (Illustrative for Educational Comparison) */
  const TEST_DEFINITIONS = {
    earth_nc: {
      name: 'Earth Leakage Current',
      condition: 'Normal Condition (NC)',
      flowPath: 'Mains L/N → DUT Internal Capacitance → Protective Earth Conductor → ESA 1kΩ MD',
      baseRange: [50.0, 85.0],
      iecCfLimit: 500.0,
      description: 'Evaluates current flowing through the protective earth conductor under normal mains supply conditions.'
    },
    earth_sfc_neutral: {
      name: 'Earth Leakage Current',
      condition: 'Single Fault Condition (Open Neutral)',
      flowPath: 'Mains Supply (Neutral Broken) → Return path forced through Protective Earth → ESA MD',
      baseRange: [120.0, 185.0],
      iecCfLimit: 1000.0,
      description: 'Simulates severed supply neutral line. Current return is forced through the protective ground path.'
    },
    enclosure_nc: {
      name: 'Enclosure (Touch) Leakage',
      condition: 'Normal Condition (NC)',
      flowPath: 'DUT Metal/Plastic Enclosure → Touch Probe → ESA Measuring Device (MD) → Earth',
      baseRange: [12.0, 24.0],
      iecCfLimit: 100.0,
      description: 'Measures current that could flow through a nurse or clinician touching the monitor chassis to earth.'
    },
    enclosure_sfc_earth: {
      name: 'Enclosure (Touch) Leakage',
      condition: 'Single Fault Condition (Open Earth)',
      flowPath: 'DUT Chassis (Unbonded) → Touch Probe → Operator Body Resistance (1kΩ MD) → Ground',
      baseRange: [85.0, 165.0],
      iecCfLimit: 500.0,
      description: 'Simulates broken protective earth wire. Stray enclosure current must now flow through the touch probe.'
    },
    patient_nc: {
      name: 'Patient Leakage Current',
      condition: 'Normal Condition (NC, Applied Parts to Earth)',
      flowPath: 'ECG Patient Leads (RA/LA/LL) → Patient Simulator → ESA Applied Parts Block → Earth',
      baseRange: [3.0, 8.5],
      iecCfLimit: 10.0, // Strict 10 µA limit for Type CF (Cardiac Floating)
      description: 'Measures minute currents flowing from cardiac electrodes through heart muscle to earth under normal conditions.'
    },
    patient_sfc_earth: {
      name: 'Patient Leakage Current',
      condition: 'Single Fault Condition (Open Earth)',
      flowPath: 'Mains Internal Stray Capacitance → Patient Electrodes (Broken Earth) → ESA MD Shunt',
      baseRange: [18.0, 38.0],
      iecCfLimit: 50.0,
      description: 'Evaluates patient electrode current when the protective earth path has failed, risking microshock.'
    },
    patient_sfc_mains: {
      name: 'Patient Leakage Current',
      condition: 'Single Fault Condition (Mains Voltage on Applied Part)',
      flowPath: 'Simulated External Mains Potential on Patient Leads → Patient Isolation Barrier → Earth',
      baseRange: [24.0, 48.0],
      iecCfLimit: 50.0,
      description: 'Simulates accidental external mains voltage touching patient connection leads (evaluates isolation barrier).'
    }
  };

  /* Three.js Environment Variables */
  let scene, camera, renderer, controls;
  let animFrameId = null;
  let canvasContainer = null;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  // 3D Objects References
  let labRoomGroup, workbenchGroup, monitorGroup, analyzerGroup, phantomGroup;
  let connectingCables = [];
  let monitorScreenMesh, analyzerScreenMesh;
  let monitorPowerLedMesh, analyzerStatusLedMesh;
  let activePulseCables = [];

  // Canvas Textures
  let monitorCanvas, monitorCtx, monitorTexture;
  let analyzerCanvas, analyzerCtx, analyzerTexture;
  let ecgCanvasTime = 0;
  let ecgPoints = [];

  /* DOM Element References */
  const DOM = {
    canvasContainer: document.getElementById('canvas-container'),
    canvasLoader: document.getElementById('canvas-loader'),
    webglErrorOverlay: document.getElementById('webgl-error-overlay'),
    webglErrorMessage: document.getElementById('webgl-error-message'),

    // HUD & Controls
    camButtons: document.querySelectorAll('.cam-btn[data-view]'),
    resetCamBtn: document.getElementById('reset-cam-btn'),
    hudPowerBtn: document.getElementById('hud-power-btn'),
    hudPowerText: document.getElementById('hud-power-text'),
    hudGlowBtn: document.getElementById('hud-glow-btn'),
    hudLeadsStatus: document.getElementById('hud-leads-status'),
    testInfoPopup: document.getElementById('test-info-popup'),
    popupCloseBtn: document.getElementById('popup-close-btn'),
    popupTestType: document.getElementById('popup-test-type'),
    popupCircuitTitle: document.getElementById('popup-circuit-title'),
    popupCircuitDesc: document.getElementById('popup-circuit-desc'),
    popupActivePath: document.getElementById('popup-active-path'),
    inspectTag: document.getElementById('inspect-tag'),
    inspectTitle: document.getElementById('inspect-title'),
    inspectDesc: document.getElementById('inspect-desc'),

    // KPIs
    kpiDutStatus: document.getElementById('kpi-dut-status'),
    kpiTestBadge: document.getElementById('kpi-test-badge'),
    kpiTestName: document.getElementById('kpi-test-name'),
    kpiReadingVal: document.getElementById('kpi-reading-val'),
    kpiEvalBadge: document.getElementById('kpi-eval-badge'),
    kpiEvalVal: document.getElementById('kpi-eval-val'),
    kpiEvalSub: document.getElementById('kpi-eval-sub'),

    // Workflow & Console
    step1Tracker: document.getElementById('step-1-tracker'),
    step2Tracker: document.getElementById('step-2-tracker'),
    step3Tracker: document.getElementById('step-3-tracker'),
    step4Tracker: document.getElementById('step-4-tracker'),
    step5Tracker: document.getElementById('step-5-tracker'),
    step6Tracker: document.getElementById('step-6-tracker'),
    testStatusPill: document.getElementById('test-status-pill'),
    testTypeSelect: document.getElementById('test-type-select'),
    mainsPolaritySelect: document.getElementById('mains-polarity-select'),
    peConditionSelect: document.getElementById('pe-condition-select'),
    chkMains: document.getElementById('chk-mains'),
    chkEarth: document.getElementById('chk-earth'),
    chkProbe: document.getElementById('chk-probe'),
    chkApplied: document.getElementById('chk-applied'),

    // Threshold Configuration
    enableThresholdToggle: document.getElementById('enable-threshold-toggle'),
    configStatusTag: document.getElementById('config-status-tag'),
    thresholdFieldsContainer: document.getElementById('threshold-fields-container'),
    thresholdPresetSelect: document.getElementById('threshold-preset-select'),
    thresholdLimitInput: document.getElementById('threshold-limit-input'),
    thresholdMetaInfo: document.getElementById('threshold-meta-info'),

    // Testing Execution
    progressStageText: document.getElementById('progress-stage-text'),
    progressPercent: document.getElementById('progress-percent'),
    testProgressBar: document.getElementById('test-progress-bar'),
    btnStartTest: document.getElementById('btn-start-test'),
    btnStopTest: document.getElementById('btn-stop-test'),
    btnResetTest: document.getElementById('btn-reset-test'),

    // Digital Analyzer Display
    lcdModeTag: document.getElementById('lcd-mode-tag'),
    lcdCondTag: document.getElementById('lcd-cond-tag'),
    lcdStateTag: document.getElementById('lcd-state-tag'),
    lcdMainDigits: document.getElementById('lcd-main-digits'),
    lcdMeterBar: document.getElementById('lcd-meter-bar'),
    lcdThresholdVal: document.getElementById('lcd-threshold-val'),
    lcdVerdictTag: document.getElementById('lcd-verdict-tag'),

    // Evaluation Box
    evalResultBadge: document.getElementById('eval-result-badge'),
    evalResultDesc: document.getElementById('eval-result-desc'),
    evalSimVal: document.getElementById('eval-sim-val'),
    evalThreshVal: document.getElementById('eval-thresh-val'),
    evalTimeVal: document.getElementById('eval-time-val'),
    evalRecordVal: document.getElementById('eval-record-val'),

    // Mirror Preview
    mirrorCanvas: document.getElementById('mirror-ecg-canvas'),
    mirrorDutStatus: document.getElementById('dut-mirror-status'),
    mirrorHrVal: document.getElementById('mirror-hr-val'),
    mirrorSpo2Val: document.getElementById('mirror-spo2-val'),
    mirrorRespVal: document.getElementById('mirror-resp-val'),

    // History Table
    historyTableBody: document.getElementById('history-table-body'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    btnClearHistory: document.getElementById('btn-clear-history'),

    // Modal
    clearModal: document.getElementById('clear-modal'),
    modalCancelBtn: document.getElementById('modal-cancel-btn'),
    modalConfirmBtn: document.getElementById('modal-confirm-btn'),

    // Toast Container
    toastContainer: document.getElementById('toast-container')
  };

  /* ==========================================================================
     INITIALIZATION & VERIFICATION
     ========================================================================== */
  function initApplication() {
    // 1. Verify Three.js library availability
    if (typeof THREE === 'undefined') {
      showWebGLError('Three.js library failed to load from CDN. Please check internet connection.');
      return;
    }

    // 2. Initialize 3D Engine & Scene
    try {
      initThreeScene();
      buildVirtualLaboratory();
    } catch (err) {
      console.error('Three.js initialization failure:', err);
      showWebGLError('WebGL initialization error: ' + err.message);
      return;
    }

    // 3. Initialize Dynamic Canvas Textures
    initMonitorScreenCanvas();
    initAnalyzerScreenCanvas();

    // 4. Initialize Local History
    loadHistoryFromStorage();

    // 5. Setup UI Event Listeners
    setupEventListeners();

    // 6. Update Initial UI State
    updateWorkflowView();
    updateThresholdUI();
    renderAnalyzerDisplay(0.0, 'IDLE');

    // 7. Hide Loader
    setTimeout(() => {
      if (DOM.canvasLoader) {
        DOM.canvasLoader.style.opacity = '0';
        setTimeout(() => { DOM.canvasLoader.style.display = 'none'; }, 500);
      }
      showToast('3D Laboratory initialized. Ready for electrical safety testing.', 'info');
    }, 400);

    // 8. Start Global Animation Loop
    startAnimationLoop();
  }

  function showWebGLError(msg) {
    if (DOM.canvasLoader) DOM.canvasLoader.style.display = 'none';
    if (DOM.webglErrorOverlay) {
      DOM.webglErrorOverlay.style.display = 'flex';
      if (DOM.webglErrorMessage) DOM.webglErrorMessage.textContent = msg;
    }
  }

  /* ==========================================================================
     THREE.JS 3D SCENE CREATION & LIGHTING
     ========================================================================== */
  function initThreeScene() {
    canvasContainer = DOM.canvasContainer;
    const width = canvasContainer.clientWidth;
    const height = canvasContainer.clientHeight;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070d19);
    scene.fog = new THREE.FogExp2(0x070d19, 0.12);

    // Camera
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.85, 2.75);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    canvasContainer.appendChild(renderer.domElement);

    // OrbitControls
    if (typeof THREE.OrbitControls !== 'undefined') {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep camera above laboratory floor
      controls.minDistance = 0.8;
      controls.maxDistance = 6.0;
      controls.target.set(0, 0.95, 0);
      controls.update();
    } else {
      console.warn('OrbitControls not loaded. Fallback basic interaction active.');
    }

    // Ambient Lighting
    const ambientLight = new THREE.AmbientLight(0x4a658a, 0.65);
    scene.add(ambientLight);

    // Main Overhead Directional Key Light with Soft Shadows
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
    keyLight.position.set(2.5, 4.5, 2.0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 10;
    keyLight.shadow.camera.left = -2.5;
    keyLight.shadow.camera.right = 2.5;
    keyLight.shadow.camera.top = 2.5;
    keyLight.shadow.camera.bottom = -2.5;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    // Overhead Laboratory Fluorescent Luminaire 1
    const ceilingLight1 = new THREE.PointLight(0xdbeafe, 0.5, 6);
    ceilingLight1.position.set(-0.8, 3.2, 0.2);
    scene.add(ceilingLight1);

    // Overhead Laboratory Fluorescent Luminaire 2
    const ceilingLight2 = new THREE.PointLight(0xdbeafe, 0.5, 6);
    ceilingLight2.position.set(0.8, 3.2, 0.2);
    scene.add(ceilingLight2);

    // Medical Cyan Accent Light (Workbench Glow)
    const benchAccentLight = new THREE.PointLight(0x00f2fe, 0.35, 3);
    benchAccentLight.position.set(0, 1.4, 0.5);
    scene.add(benchAccentLight);
  }

  /* ==========================================================================
     PROCEDURAL 3D LABORATORY MODELING (ROOM, BENCH, EQUIPMENT, CABLES)
     ========================================================================== */
  function buildVirtualLaboratory() {
    labRoomGroup = new THREE.Group();
    workbenchGroup = new THREE.Group();
    scene.add(labRoomGroup);
    scene.add(workbenchGroup);

    // 1. Laboratory Floor with Procedural Vinyl Tile Texture
    const floorGeo = new THREE.PlaneGeometry(12, 12);
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const fCtx = floorCanvas.getContext('2d');
    fCtx.fillStyle = '#0b162c';
    fCtx.fillRect(0, 0, 512, 512);
    fCtx.strokeStyle = 'rgba(0, 242, 254, 0.08)';
    fCtx.lineWidth = 2;
    const tileSize = 64;
    for (let x = 0; x <= 512; x += tileSize) {
      fCtx.beginPath(); fCtx.moveTo(x, 0); fCtx.lineTo(x, 512); fCtx.stroke();
      fCtx.beginPath(); fCtx.moveTo(0, x); fCtx.lineTo(512, x); fCtx.stroke();
    }
    const floorTexture = new THREE.CanvasTexture(floorCanvas);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(6, 6);

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.45,
      metalness: 0.15
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    labRoomGroup.add(floorMesh);

    // 2. Laboratory Back Wall with Medical Cyan Dado Stripe
    const backWallGeo = new THREE.PlaneGeometry(12, 6);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0e1c38,
      roughness: 0.8,
      metalness: 0.05
    });
    const backWall = new THREE.Mesh(backWallGeo, wallMat);
    backWall.position.set(0, 3, -2.5);
    backWall.receiveShadow = true;
    labRoomGroup.add(backWall);

    // Cyan Medical Dado Line on Back Wall
    const stripeGeo = new THREE.PlaneGeometry(12, 0.08);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
    const dadoStripe = new THREE.Mesh(stripeGeo, stripeMat);
    dadoStripe.position.set(0, 1.8, -2.49);
    labRoomGroup.add(dadoStripe);

    // Lab Safety Placard on Wall
    const placardGeo = new THREE.PlaneGeometry(1.2, 0.6);
    const placardCanvas = document.createElement('canvas');
    placardCanvas.width = 512;
    placardCanvas.height = 256;
    const pCtx = placardCanvas.getContext('2d');
    pCtx.fillStyle = '#061325';
    pCtx.fillRect(0, 0, 512, 256);
    pCtx.strokeStyle = '#ffaa00';
    pCtx.lineWidth = 10;
    pCtx.strokeRect(5, 5, 502, 246);
    pCtx.fillStyle = '#ffaa00';
    pCtx.font = 'bold 34px sans-serif';
    pCtx.textAlign = 'center';
    pCtx.fillText('⚠️ CAUTION: ELECTRICAL TEST BENCH', 256, 70);
    pCtx.fillStyle = '#ffffff';
    pCtx.font = '24px sans-serif';
    pCtx.fillText('IEC 60601-1 LEAKAGE CURRENT STATION', 256, 125);
    pCtx.fillStyle = '#00f2fe';
    pCtx.font = '20px sans-serif';
    pCtx.fillText('CALIBRATION VALID — CERTIFIED ISO 17025', 256, 185);
    const placardTex = new THREE.CanvasTexture(placardCanvas);
    const placardMesh = new THREE.Mesh(placardGeo, new THREE.MeshBasicMaterial({ map: placardTex }));
    placardMesh.position.set(0, 2.3, -2.48);
    labRoomGroup.add(placardMesh);

    // 3. Sturdy Anti-Static Laboratory Workbench
    // Table Top (ESD Dissipative Surface)
    const tableTopGeo = new THREE.BoxGeometry(2.4, 0.08, 1.1);
    const tableTopMat = new THREE.MeshStandardMaterial({
      color: 0x182846,
      roughness: 0.35,
      metalness: 0.2
    });
    const tableTop = new THREE.Mesh(tableTopGeo, tableTopMat);
    tableTop.position.set(0, 0.85, 0);
    tableTop.receiveShadow = true;
    tableTop.castShadow = true;
    workbenchGroup.add(tableTop);

    // Workbench Metal Legs & Aluminum Frame
    const legGeo = new THREE.BoxGeometry(0.06, 0.85, 0.06);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.2 });
    const legPositions = [
      [-1.12, 0.425, 0.48],
      [1.12, 0.425, 0.48],
      [-1.12, 0.425, -0.48],
      [1.12, 0.425, -0.48]
    ];
    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(...pos);
      leg.castShadow = true;
      workbenchGroup.add(leg);
    });

    // Rear Instrument Shelf Riser
    const shelfGeo = new THREE.BoxGeometry(2.4, 0.05, 0.35);
    const shelf = new THREE.Mesh(shelfGeo, tableTopMat);
    shelf.position.set(0, 1.25, -0.36);
    shelf.castShadow = true;
    workbenchGroup.add(shelf);

    const shelfPostGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 16);
    [-0.9, 0, 0.9].forEach(x => {
      const post = new THREE.Mesh(shelfPostGeo, legMat);
      post.position.set(x, 1.05, -0.36);
      workbenchGroup.add(post);
    });

    // Power Strip Mounted Under Rear Shelf
    const pduGeo = new THREE.BoxGeometry(0.8, 0.06, 0.08);
    const pduMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
    const pdu = new THREE.Mesh(pduGeo, pduMat);
    pdu.position.set(0, 0.92, -0.42);
    workbenchGroup.add(pdu);

    // 4. Build Patient Monitor (DUT)
    buildPatientMonitor();

    // 5. Build Electrical Safety Analyzer (ESA)
    buildSafetyAnalyzer();

    // 6. Build Patient Simulator Accessory Box
    buildPatientSimulator();

    // 7. Build Connecting Harness Cables
    buildInterconnectingCables();
  }

  /* ==========================================================================
     PATIENT MONITOR 3D MODEL & DYNAMIC SCREEN
     ========================================================================== */
  function buildPatientMonitor() {
    monitorGroup = new THREE.Group();
    monitorGroup.position.set(-0.55, 0.89, 0.05);
    monitorGroup.rotation.y = 0.15; // Angled slightly towards center
    monitorGroup.name = 'PatientMonitor';
    scene.add(monitorGroup);

    // Base Stand / Swivel Mount
    const standBaseGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.03, 32);
    const standMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.6, roughness: 0.3 });
    const standBase = new THREE.Mesh(standBaseGeo, standMat);
    standBase.position.set(0, 0.015, 0);
    monitorGroup.add(standBase);

    const standStemGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.14, 24);
    const standStem = new THREE.Mesh(standStemGeo, standMat);
    standStem.position.set(0, 0.09, 0);
    monitorGroup.add(standStem);

    // Main Monitor Enclosure (Medical Ivory Plastic with Bevels)
    const casingGeo = new THREE.BoxGeometry(0.48, 0.36, 0.16);
    const casingMat = new THREE.MeshStandardMaterial({
      color: 0xedf2f7,
      roughness: 0.25,
      metalness: 0.05
    });
    const casing = new THREE.Mesh(casingGeo, casingMat);
    casing.position.set(0, 0.28, 0);
    casing.castShadow = true;
    casing.receiveShadow = true;
    monitorGroup.add(casing);

    // Top Integrated Ergonomic Handle
    const handleGeo = new THREE.TorusGeometry(0.07, 0.012, 12, 32, Math.PI);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.3 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, 0.46, 0);
    monitorGroup.add(handle);

    // Rubberized Bumpers on Enclosure Corners
    const bumperGeo = new THREE.BoxGeometry(0.02, 0.36, 0.02);
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x0284c7 });
    [-0.24, 0.24].forEach(x => {
      const bumper = new THREE.Mesh(bumperGeo, bumperMat);
      bumper.position.set(x, 0.28, 0.08);
      monitorGroup.add(bumper);
    });

    // Dark Screen Bezel Frame
    const bezelGeo = new THREE.BoxGeometry(0.42, 0.31, 0.01);
    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x090e17, roughness: 0.5 });
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.position.set(-0.02, 0.28, 0.085);
    monitorGroup.add(bezel);

    // Dynamic LCD Screen Mesh (CanvasTexture)
    const screenGeo = new THREE.PlaneGeometry(0.38, 0.27);
    monitorScreenMesh = new THREE.Mesh(screenGeo);
    monitorScreenMesh.position.set(-0.02, 0.28, 0.091);
    monitorGroup.add(monitorScreenMesh);

    // Right-Hand Physical Control Column
    // Rotary Encoder Knob
    const knobGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.025, 24);
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.2 });
    const knob = new THREE.Mesh(knobGeo, knobMat);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0.205, 0.22, 0.09);
    monitorGroup.add(knob);

    // Power Pushbutton with Glowing Indicator LED
    const pwrBtnGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.012, 20);
    const pwrBtnMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });
    const pwrBtn = new THREE.Mesh(pwrBtnGeo, pwrBtnMat);
    pwrBtn.rotation.x = Math.PI / 2;
    pwrBtn.position.set(0.205, 0.38, 0.09);
    monitorGroup.add(pwrBtn);

    const ledGeo = new THREE.SphereGeometry(0.006, 16, 16);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00e676 });
    monitorPowerLedMesh = new THREE.Mesh(ledGeo, ledMat);
    monitorPowerLedMesh.position.set(0.205, 0.405, 0.092);
    monitorGroup.add(monitorPowerLedMesh);

    // Side Applied Parts Connector Block (Defibrillator-Proof ECG Trunk Socket)
    const portBlockGeo = new THREE.BoxGeometry(0.01, 0.14, 0.08);
    const portBlockMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });
    const portBlock = new THREE.Mesh(portBlockGeo, portBlockMat);
    portBlock.position.set(-0.245, 0.26, 0);
    monitorGroup.add(portBlock);

    // Individual Color-Coded Lead Sockets (RA, LA, LL, RL, V)
    const leadColors = [0xffffff, 0x111111, 0xef4444, 0x22c55e, 0x92400e];
    leadColors.forEach((col, idx) => {
      const pinGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.01, 16);
      const pinMat = new THREE.MeshStandardMaterial({ color: col });
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.rotation.z = Math.PI / 2;
      pin.position.set(-0.252, 0.31 - idx * 0.024, 0.015);
      monitorGroup.add(pin);
    });

    // Rear Equipotential Earth Lug Stud (Grounding terminal for Class I)
    const lugGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.025, 16);
    const lugMat = new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.9, roughness: 0.2 });
    const lug = new THREE.Mesh(lugGeo, lugMat);
    lug.rotation.x = Math.PI / 2;
    lug.position.set(-0.15, 0.18, -0.09);
    monitorGroup.add(lug);
  }

  /* ==========================================================================
     ELECTRICAL SAFETY ANALYZER (ESA) 3D MODEL & DIGITAL DISPLAY
     ========================================================================== */
  function buildSafetyAnalyzer() {
    analyzerGroup = new THREE.Group();
    analyzerGroup.position.set(0.55, 0.89, 0.05);
    analyzerGroup.rotation.y = -0.15; // Angled inward
    analyzerGroup.name = 'SafetyAnalyzer';
    scene.add(analyzerGroup);

    // Main Heavy-Duty Ruggedized Chassis (Charcoal Grey with Safety Yellow Trim)
    const bodyGeo = new THREE.BoxGeometry(0.52, 0.18, 0.38);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.2
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0.09, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    analyzerGroup.add(body);

    // Angled Front Faceplate Wedge for Clear Viewing
    const faceplateGeo = new THREE.BoxGeometry(0.50, 0.02, 0.36);
    const faceplateMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
    const faceplate = new THREE.Mesh(faceplateGeo, faceplateMat);
    faceplate.position.set(0, 0.185, 0);
    faceplate.rotation.x = 0.12; // Slight tilt towards user
    analyzerGroup.add(faceplate);

    // Digital VFD/LCD Screen Mesh (CanvasTexture)
    const screenGeo = new THREE.PlaneGeometry(0.28, 0.16);
    analyzerScreenMesh = new THREE.Mesh(screenGeo);
    analyzerScreenMesh.position.set(-0.08, 0.205, -0.02);
    analyzerScreenMesh.rotation.x = -Math.PI / 2 + 0.12;
    analyzerGroup.add(analyzerScreenMesh);

    // Test Mains Receptacle (Standard Grounded 3-Pin Socket for DUT Plug)
    const socketHousingGeo = new THREE.BoxGeometry(0.09, 0.02, 0.09);
    const socketHousingMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
    const socketHousing = new THREE.Mesh(socketHousingGeo, socketHousingMat);
    socketHousing.position.set(0.16, 0.198, 0.08);
    socketHousing.rotation.x = 0.12;
    analyzerGroup.add(socketHousing);

    // Ground & Line Socket Holes
    const holeGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.01, 16);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const hole1 = new THREE.Mesh(holeGeo, holeMat);
    hole1.position.set(0.145, 0.208, 0.08);
    analyzerGroup.add(hole1);
    const hole2 = new THREE.Mesh(holeGeo, holeMat);
    hole2.position.set(0.175, 0.208, 0.08);
    analyzerGroup.add(hole2);

    // Front Applied Parts Terminal Block (5 Multi-Color Banana Sockets)
    const apBlockGeo = new THREE.BoxGeometry(0.24, 0.02, 0.05);
    const apBlockMat = new THREE.MeshStandardMaterial({ color: 0x090e17 });
    const apBlock = new THREE.Mesh(apBlockGeo, apBlockMat);
    apBlock.position.set(-0.08, 0.20, 0.11);
    apBlock.rotation.x = 0.12;
    analyzerGroup.add(apBlock);

    const apColors = [0xffffff, 0x111111, 0xef4444, 0x22c55e, 0xa16207];
    apColors.forEach((c, i) => {
      const jackGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.015, 16);
      const jackMat = new THREE.MeshStandardMaterial({ color: c, metalness: 0.6 });
      const jack = new THREE.Mesh(jackGeo, jackMat);
      jack.position.set(-0.16 + i * 0.04, 0.21, 0.11);
      analyzerGroup.add(jack);
    });

    // Earth Bond / Enclosure Touch Probe Terminal Socket (Green Binding Post)
    const probeJackGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.02, 16);
    const probeJackMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, metalness: 0.5 });
    const probeJack = new THREE.Mesh(probeJackGeo, probeJackMat);
    probeJack.position.set(0.16, 0.205, -0.06);
    analyzerGroup.add(probeJack);

    // Front Physical Pushbuttons (Start, Stop, Select)
    const btnColors = [0x00e676, 0xff3d71, 0x0077fe];
    btnColors.forEach((col, idx) => {
      const bGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.01, 16);
      const bMat = new THREE.MeshStandardMaterial({ color: col });
      const b = new THREE.Mesh(bGeo, bMat);
      b.position.set(0.10 + idx * 0.04, 0.202, 0.01);
      analyzerGroup.add(b);
    });

    // High Voltage / Testing Status Indicator LED
    const esaLedGeo = new THREE.SphereGeometry(0.006, 16, 16);
    const esaLedMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
    analyzerStatusLedMesh = new THREE.Mesh(esaLedGeo, esaLedMat);
    analyzerStatusLedMesh.position.set(-0.21, 0.21, -0.08);
    analyzerGroup.add(analyzerStatusLedMesh);
  }

  /* ==========================================================================
     PATIENT SIMULATOR ACCESSORY BOX (CLEARLY LABELED AS SIMULATED ACCESSORY)
     ========================================================================== */
  function buildPatientSimulator() {
    phantomGroup = new THREE.Group();
    phantomGroup.position.set(0, 0.89, -0.15);
    phantomGroup.name = 'PatientSimulator';
    scene.add(phantomGroup);

    // Small Desktop Accessory Enclosure
    const boxGeo = new THREE.BoxGeometry(0.24, 0.06, 0.16);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.3 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(0, 0.03, 0);
    box.castShadow = true;
    phantomGroup.add(box);

    // Top Label Strip: "PATIENT PHANTOM (SIMULATED ACCESSORY)"
    const labelGeo = new THREE.PlaneGeometry(0.21, 0.05);
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const lCtx = labelCanvas.getContext('2d');
    lCtx.fillStyle = '#0f172a';
    lCtx.fillRect(0, 0, 512, 128);
    lCtx.strokeStyle = '#00f2fe';
    lCtx.lineWidth = 4;
    lCtx.strokeRect(4, 4, 504, 120);
    lCtx.fillStyle = '#00f2fe';
    lCtx.font = 'bold 26px sans-serif';
    lCtx.textAlign = 'center';
    lCtx.fillText('PATIENT SIMULATOR', 256, 52);
    lCtx.fillStyle = '#ffaa00';
    lCtx.font = 'bold 20px sans-serif';
    lCtx.fillText('SIMULATED ACCESSORY ONLY', 256, 95);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: labelTex }));
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.set(0, 0.061, -0.02);
    phantomGroup.add(labelMesh);

    // 5 Snap Studs for ECG Lead Attachment
    for (let i = 0; i < 5; i++) {
      const snapGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.01, 16);
      const snapMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.1 });
      const snap = new THREE.Mesh(snapGeo, snapMat);
      snap.position.set(-0.08 + i * 0.04, 0.065, 0.045);
      phantomGroup.add(snap);
    }
  }

  /* ==========================================================================
     INTERCONNECTING 3D CABLES (CURVED TUBES WITH ACTIVE CURRENT GLOW)
     ========================================================================== */
  function buildInterconnectingCables() {
    connectingCables.forEach(c => scene.remove(c));
    connectingCables = [];

    // Helper: Create Smooth CatmullRom Tube Cable
    function createCable(points, radius, color, isEarthStriped = false) {
      const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
      const geometry = new THREE.TubeGeometry(curve, 48, radius, 10, false);
      const material = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.6,
        metalness: 0.1,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      scene.add(mesh);
      connectingCables.push(mesh);
      return mesh;
    }

    // 1. Mains Power Cord: Patient Monitor rear inlet -> Safety Analyzer front test socket
    const powerCordPoints = [
      [-0.55, 1.05, -0.04],  // Monitor rear power socket
      [-0.45, 0.91, -0.15],  // Draping onto workbench
      [0.0, 0.90, -0.05],    // Bench center curve
      [0.45, 0.92, 0.08],    // Approaching analyzer
      [0.68, 1.08, 0.12]     // Plugged into analyzer test receptacle
    ];
    const powerCable = createCable(powerCordPoints, 0.009, 0x1e293b);
    powerCable.userData = { testTypes: ['earth_nc', 'earth_sfc_neutral'] };

    // 2. Protective Earth Bonding Lead: Green/Yellow Ground Cable
    const earthLeadPoints = [
      [-0.68, 1.06, -0.03],  // Monitor chassis earth stud
      [-0.60, 0.91, -0.08],  // Dropping to table surface
      [0.05, 0.905, 0.10],   // Trailing across bench
      [0.68, 1.08, -0.01]    // Analyzer green earth bond terminal
    ];
    const earthCable = createCable(earthLeadPoints, 0.006, 0x16a34a, true);
    earthCable.userData = { testTypes: ['earth_nc', 'earth_sfc_neutral', 'enclosure_sfc_earth', 'patient_sfc_earth'] };

    // 3. ECG Patient Lead Trunk Cable: Monitor side port -> Patient Simulator / Analyzer
    const ecgHarnessPoints = [
      [-0.78, 1.15, 0.06],   // Monitor left side ECG connector
      [-0.65, 0.92, 0.02],   // Dropping to table
      [-0.25, 0.91, -0.10],  // Entering patient simulator
      [0.0, 0.94, -0.11]     // Connected to simulator snaps
    ];
    const ecgCable = createCable(ecgHarnessPoints, 0.007, 0x0284c7);
    ecgCable.userData = { testTypes: ['patient_nc', 'patient_sfc_earth', 'patient_sfc_mains'] };

    // 4. Applied Parts Interconnect: Patient Simulator -> Analyzer Applied Parts Block
    const apJumperPoints = [
      [0.0, 0.94, -0.10],
      [0.22, 0.91, 0.02],
      [0.46, 1.08, 0.15]
    ];
    const apCable = createCable(apJumperPoints, 0.006, 0x0ea5e9);
    apCable.userData = { testTypes: ['patient_nc', 'patient_sfc_earth', 'patient_sfc_mains'] };

    // 5. Enclosure Touch Probe Lead: Analyzer touch probe socket -> Monitor metal chassis touch point
    const touchProbePoints = [
      [0.68, 1.08, -0.01],
      [0.35, 0.915, 0.22],
      [-0.20, 0.915, 0.20],
      [-0.35, 1.14, 0.08]    // Touching metallic monitor screw/casing
    ];
    const touchProbeCable = createCable(touchProbePoints, 0.005, 0xeab308);
    touchProbeCable.userData = { testTypes: ['enclosure_nc', 'enclosure_sfc_earth'] };
  }

  /* ==========================================================================
     DYNAMIC CANVAS TEXTURES (PATIENT MONITOR & SAFETY ANALYZER)
     ========================================================================== */
  function initMonitorScreenCanvas() {
    monitorCanvas = document.createElement('canvas');
    monitorCanvas.width = 512;
    monitorCanvas.height = 384;
    monitorCtx = monitorCanvas.getContext('2d');
    monitorTexture = new THREE.CanvasTexture(monitorCanvas);
    monitorTexture.minFilter = THREE.LinearFilter;

    if (monitorScreenMesh) {
      monitorScreenMesh.material = new THREE.MeshBasicMaterial({ map: monitorTexture });
    }
  }

  function initAnalyzerScreenCanvas() {
    analyzerCanvas = document.createElement('canvas');
    analyzerCanvas.width = 512;
    analyzerCanvas.height = 300;
    analyzerCtx = analyzerCanvas.getContext('2d');
    analyzerTexture = new THREE.CanvasTexture(analyzerCanvas);
    analyzerTexture.minFilter = THREE.LinearFilter;

    if (analyzerScreenMesh) {
      analyzerScreenMesh.material = new THREE.MeshBasicMaterial({ map: analyzerTexture });
    }
  }

  /* Update Patient Monitor Screen (Render Simulated ECG, SpO2, Respiration Waves) */
  function updatePatientMonitorCanvas(time) {
    if (!monitorCtx) return;
    const ctx = monitorCtx;
    const w = monitorCanvas.width;
    const h = monitorCanvas.height;

    // If Monitor Power is OFF: Draw Dark Standby Screen
    if (!AppState.dutPower) {
      ctx.fillStyle = '#050a14';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#334155';
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('STANDBY / POWER OFF', w / 2, h / 2 - 10);
      ctx.font = '16px sans-serif';
      ctx.fillText('Turn ON monitor to energize Device Under Test', w / 2, h / 2 + 25);
      monitorTexture.needsUpdate = true;
      return;
    }

    // Power is ON: Draw Medical Monitoring Screen
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Grid Lines (Subtle Medical CRT Raster)
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Top Header Banner
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, 40);
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('BED 04 | ADULT NORMAL', 16, 26);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'right';
    const isPulsing = Math.sin(time * 6) > 0;
    ctx.fillText(isPulsing ? '♥ HR SYNCHRONIZED' : '  HR SYNCHRONIZED', w - 16, 26);

    // Channel 1: Lead II ECG Waveform (Green)
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 4;
    ctx.beginPath();

    const sweepX = (time * 120) % (w - 140);
    for (let x = 16; x < w - 140; x += 2) {
      // Synthesize P-Q-R-S-T Cardiac Complex
      const cycle = ((x + time * 120) % 200) / 200;
      let y = 120;
      if (cycle > 0.15 && cycle < 0.22) { // P-wave
        y -= Math.sin((cycle - 0.15) / 0.07 * Math.PI) * 12;
      } else if (cycle >= 0.22 && cycle < 0.25) { // Q-dip
        y += 6;
      } else if (cycle >= 0.25 && cycle < 0.30) { // R-spike
        y -= Math.sin((cycle - 0.25) / 0.05 * Math.PI) * 65;
      } else if (cycle >= 0.30 && cycle < 0.33) { // S-dip
        y += 14;
      } else if (cycle > 0.40 && cycle < 0.55) { // T-wave
        y -= Math.sin((cycle - 0.40) / 0.15 * Math.PI) * 20;
      }
      // Add minor physiological baseline jitter
      y += (Math.sin(x * 0.05) + Math.cos(x * 0.1)) * 1.5;

      if (x === 16) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Channel 2: SpO2 Plethysmogram (Cyan)
    ctx.strokeStyle = '#06b6d4';
    ctx.shadowColor = '#06b6d4';
    ctx.beginPath();
    for (let x = 16; x < w - 140; x += 2) {
      const cycle = ((x + time * 120) % 200) / 200;
      let y = 210;
      if (cycle > 0.25 && cycle < 0.65) {
        y -= Math.sin((cycle - 0.25) / 0.40 * Math.PI) * 32;
        if (cycle > 0.42 && cycle < 0.50) y += 8; // Dicrotic notch
      }
      if (x === 16) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Channel 3: Respiration Waveform (Yellow)
    ctx.strokeStyle = '#eab308';
    ctx.shadowColor = '#eab308';
    ctx.beginPath();
    for (let x = 16; x < w - 140; x += 3) {
      const y = 295 + Math.sin(x * 0.03 + time * 2) * 18;
      if (x === 16) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Erase Sweep Cursor Bar
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000000';
    ctx.fillRect(sweepX + 16, 42, 14, 280);

    // Right-Hand Parameter Display Columns
    // HR Box
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('HR BPM', w - 120, 75);
    ctx.font = 'bold 36px monospace';
    ctx.fillText(AppState.heartRate.toString(), w - 120, 115);

    // SpO2 Box
    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('SpO2 %', w - 120, 175);
    ctx.font = 'bold 36px monospace';
    ctx.fillText(AppState.spO2.toString(), w - 120, 215);

    // Respiration Box
    ctx.fillStyle = '#eab308';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('RESP RPM', w - 120, 275);
    ctx.font = 'bold 36px monospace';
    ctx.fillText(AppState.respRate.toString(), w - 120, 315);

    // Bottom Educational Disclaimer Strip
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, h - 34, w, 34);
    ctx.fillStyle = '#f59e0b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SIMULATED EDUCATIONAL VALUES — NOT ACTUAL PATIENT DATA', w / 2, h - 12);

    monitorTexture.needsUpdate = true;

    // Also mirror to the DOM 2D Canvas in the faceplate card
    updateMirrorDutCanvas(time);
  }

  /* Render 3D Safety Analyzer Digital LCD Faceplate */
  function renderAnalyzerDisplay(measuredValue, testState) {
    if (!analyzerCtx) return;
    const ctx = analyzerCtx;
    const w = analyzerCanvas.width;
    const h = analyzerCanvas.height;

    // Dark VFD Glass Background
    ctx.fillStyle = '#020e17';
    ctx.fillRect(0, 0, w, h);

    // Top Status Header Bar
    ctx.fillStyle = '#082f49';
    ctx.fillRect(0, 0, w, 44);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'left';
    const testDef = TEST_DEFINITIONS[AppState.selectedTestKey] || TEST_DEFINITIONS.earth_nc;
    ctx.fillText(testDef.name.toUpperCase(), 16, 28);

    ctx.textAlign = 'right';
    ctx.fillStyle = testState === 'TESTING...' ? '#38bdf8' : (testState === 'COMPLETED' ? '#22c55e' : '#94a3b8');
    ctx.fillText(testState, w - 16, 28);

    // Sub-header (Condition & Polarity)
    ctx.fillStyle = '#7dd3fc';
    ctx.font = '14px monospace';
    ctx.textAlign = 'left';
    const polStr = AppState.mainsPolarity === 'normal' ? 'NORM POL' : 'REV POL';
    const peStr = AppState.peSwitch === 'closed' ? 'PE: CLOSED' : 'PE: OPEN (FAULT)';
    ctx.fillText(`COND: ${peStr} | ${polStr}`, 16, 75);

    // Large Digital Reading Display (7-Segment VFD Style)
    ctx.textAlign = 'center';
    ctx.fillStyle = '#00f2fe';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 10;
    ctx.font = 'bold 72px monospace';
    const formattedVal = measuredValue.toFixed(1).padStart(5, '0');
    ctx.fillText(formattedVal, w / 2 - 25, 160);

    ctx.shadowBlur = 0;
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('µA', w / 2 + 110, 150);

    ctx.font = '13px monospace';
    ctx.fillStyle = 'rgba(0, 242, 254, 0.6)';
    ctx.fillText('TRUE RMS AC+DC LEAKAGE CURRENT (1 kHz FILTER)', w / 2, 195);

    // Progress Bar Meter Strip
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(24, 215, w - 48, 16);
    const fillW = ((w - 48) * (AppState.testProgress / 100));
    ctx.fillStyle = '#00f2fe';
    ctx.fillRect(24, 215, fillW, 16);

    // Footer Strip: Threshold & Evaluation Verdict
    ctx.fillStyle = '#082f49';
    ctx.fillRect(0, h - 42, w, 42);
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    const threshStr = AppState.thresholdConfigured ? `LIMIT: ${AppState.configuredLimit.toFixed(1)} µA` : 'LIMIT: NOT CONFIGURED';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(threshStr, 16, h - 16);

    ctx.textAlign = 'right';
    let verdictColor = '#f59e0b';
    if (AppState.lastVerdict === 'PASS') verdictColor = '#22c55e';
    else if (AppState.lastVerdict === 'FAIL') verdictColor = '#ef4444';
    ctx.fillStyle = verdictColor;
    ctx.fillText(`VERDICT: ${AppState.lastVerdict}`, w - 16, h - 16);

    analyzerTexture.needsUpdate = true;
  }

  /* DOM Patient Monitor Mirror Preview */
  function updateMirrorDutCanvas(time) {
    if (!DOM.mirrorCanvas) return;
    const ctx = DOM.mirrorCanvas.getContext('2d');
    const w = DOM.mirrorCanvas.width;
    const h = DOM.mirrorCanvas.height;

    if (!AppState.dutPower) {
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#475569';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PATIENT MONITOR OFF', w / 2, h / 2);
      return;
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Draw Small ECG Line
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < w - 120; x += 2) {
      const cycle = ((x + time * 100) % 180) / 180;
      let y = 60;
      if (cycle > 0.15 && cycle < 0.22) y -= Math.sin((cycle - 0.15) / 0.07 * Math.PI) * 10;
      else if (cycle >= 0.22 && cycle < 0.25) y += 4;
      else if (cycle >= 0.25 && cycle < 0.30) y -= Math.sin((cycle - 0.25) / 0.05 * Math.PI) * 45;
      else if (cycle >= 0.30 && cycle < 0.33) y += 10;
      else if (cycle > 0.40 && cycle < 0.55) y -= Math.sin((cycle - 0.40) / 0.15 * Math.PI) * 14;

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /* ==========================================================================
     TEST EXECUTION LOGIC & 9-STEP WORKFLOW ENGINE
     ========================================================================== */
  function startTestExecution() {
    // Step 1 Check: Verify DUT Power
    if (!AppState.dutPower) {
      showToast('Error: Turn ON Patient Monitor first to energize the Device Under Test.', 'warning');
      DOM.hudPowerBtn.classList.add('pulsing');
      setTimeout(() => DOM.hudPowerBtn.classList.remove('pulsing'), 2000);
      return;
    }

    // Step 2 & 3: Ready to Execute
    AppState.testRunning = true;
    AppState.testProgress = 0;
    AppState.lastVerdict = AppState.thresholdConfigured ? 'EVALUATING...' : 'NOT CONFIGURED';

    // UI Updates
    DOM.btnStartTest.disabled = true;
    DOM.btnStopTest.disabled = false;
    DOM.testStatusPill.textContent = 'RUNNING';
    DOM.testStatusPill.className = 'status-pill status-running';
    DOM.lcdStateTag.textContent = 'RUNNING';
    DOM.progressStageText.textContent = 'Testing in progress: Simulating current flow through human body MD...';
    DOM.evalRecordVal.textContent = 'Measurement in progress';

    highlightActiveStep(4);
    updateWorkflowView();

    // Activate Cable Glowing on Relevant Test Circuit Path
    activateCablePathGlow(AppState.selectedTestKey);

    const testDef = TEST_DEFINITIONS[AppState.selectedTestKey] || TEST_DEFINITIONS.earth_nc;
    const [minVal, maxVal] = testDef.baseRange;
    const targetReading = minVal + Math.random() * (maxVal - minVal);

    const testDurationMs = 4500; // 4.5 seconds realistic test duration
    const intervalMs = 60;
    const totalSteps = testDurationMs / intervalMs;
    let stepCount = 0;

    clearInterval(AppState.testIntervalId);
    AppState.testIntervalId = setInterval(() => {
      stepCount++;
      AppState.testProgress = Math.min(100, Math.round((stepCount / totalSteps) * 100));

      // Realistic Microampere Fluctuation during Testing
      const progressFraction = stepCount / totalSteps;
      const noise = (Math.random() - 0.5) * 4.0;
      AppState.simulatedCurrent = Math.max(0.1, (targetReading * progressFraction) + noise);

      // Update UI & Displays
      DOM.progressPercent.textContent = `${AppState.testProgress}%`;
      DOM.testProgressBar.style.width = `${AppState.testProgress}%`;
      DOM.lcdMeterBar.style.width = `${Math.min(100, (AppState.simulatedCurrent / 500) * 100)}%`;
      DOM.lcdMainDigits.textContent = AppState.simulatedCurrent.toFixed(1).padStart(5, '0');
      DOM.kpiReadingVal.innerHTML = `${AppState.simulatedCurrent.toFixed(1)} <span class="unit">µA</span>`;

      renderAnalyzerDisplay(AppState.simulatedCurrent, 'TESTING...');

      if (stepCount >= totalSteps) {
        completeTestExecution(targetReading);
      }
    }, intervalMs);
  }

  function completeTestExecution(finalValue) {
    clearInterval(AppState.testIntervalId);
    AppState.testRunning = false;
    AppState.testProgress = 100;
    AppState.simulatedCurrent = parseFloat(finalValue.toFixed(1));
    AppState.lastStableReading = AppState.simulatedCurrent;

    DOM.btnStartTest.disabled = false;
    DOM.btnStopTest.disabled = true;
    DOM.testStatusPill.textContent = 'COMPLETED';
    DOM.testStatusPill.className = 'status-pill status-ready';
    DOM.lcdStateTag.textContent = 'COMPLETED';
    DOM.progressStageText.textContent = 'Simulated test sequence completed successfully.';

    // Step 7 & 8: Explicit Threshold Comparison Logic (Section 7 Mandate)
    evaluateSafetyCompliance(AppState.simulatedCurrent);

    renderAnalyzerDisplay(AppState.simulatedCurrent, 'COMPLETED');
    highlightActiveStep(6);

    // Step 9: Add Result to History Log
    logTestResultRecord();

    showToast(`Test finished: ${AppState.simulatedCurrent.toFixed(1)} µA recorded. Safety Verdict: ${AppState.lastVerdict}`, 'info');
  }

  function stopTestExecution() {
    if (!AppState.testRunning) return;
    clearInterval(AppState.testIntervalId);
    AppState.testRunning = false;

    DOM.btnStartTest.disabled = false;
    DOM.btnStopTest.disabled = true;
    DOM.testStatusPill.textContent = 'STOPPED';
    DOM.testStatusPill.className = 'status-pill status-stopped';
    DOM.lcdStateTag.textContent = 'STOPPED';
    DOM.progressStageText.textContent = 'Test aborted by user. Current test halted safely.';
    DOM.evalRecordVal.textContent = 'Test Aborted';

    renderAnalyzerDisplay(AppState.simulatedCurrent, 'STOPPED');
    showToast('Test execution stopped by user. Previous test history preserved.', 'warning');
  }

  function resetTestExecution() {
    clearInterval(AppState.testIntervalId);
    AppState.testRunning = false;
    AppState.testProgress = 0;
    AppState.simulatedCurrent = 0.0;
    AppState.lastVerdict = AppState.thresholdConfigured ? 'READY' : 'NOT CONFIGURED';

    DOM.btnStartTest.disabled = false;
    DOM.btnStopTest.disabled = true;
    DOM.testStatusPill.textContent = 'IDLE';
    DOM.testStatusPill.className = 'status-pill status-ready';
    DOM.lcdStateTag.textContent = 'IDLE';
    DOM.progressStageText.textContent = 'System Ready';
    DOM.progressPercent.textContent = '0%';
    DOM.testProgressBar.style.width = '0%';
    DOM.lcdMeterBar.style.width = '0%';
    DOM.lcdMainDigits.textContent = '000.0';
    DOM.kpiReadingVal.innerHTML = `--.- <span class="unit">µA</span>`;
    DOM.evalRecordVal.textContent = 'Ready for Next Test';

    highlightActiveStep(2);
    updateWorkflowView();
    renderAnalyzerDisplay(0.0, 'IDLE');
    deactivateCablePathGlow();

    showToast('Analyzer reset to ready state. Previous audit records preserved.', 'info');
  }

  /* ==========================================================================
     SECTION 7: EXPLICIT THRESHOLD COMPLIANCE EVALUATION LOGIC
     ========================================================================== */
  function evaluateSafetyCompliance(measuredCurrent) {
    const testDef = TEST_DEFINITIONS[AppState.selectedTestKey] || TEST_DEFINITIONS.earth_nc;
    const now = new Date();
    const timeStr = now.toLocaleTimeString();

    DOM.evalSimVal.textContent = `${measuredCurrent.toFixed(1)} µA`;
    DOM.evalTimeVal.textContent = timeStr;
    DOM.evalRecordVal.textContent = 'Logged to Storage';

    // If threshold configuration is DISABLED or invalid:
    if (!AppState.thresholdConfigured) {
      AppState.lastVerdict = 'NOT CONFIGURED';
      DOM.evalResultBadge.textContent = 'NOT CONFIGURED';
      DOM.evalResultBadge.className = 'eval-badge-pill unconfigured';
      DOM.evalResultDesc.innerHTML = `<strong>NOT CONFIGURED:</strong> No verified applicable threshold is available. Per international biomedical safety protocol, simulated PASS/FAIL evaluation is withheld until an applicable standard, equipment classification, test condition, and verified limit are explicitly configured.`;
      DOM.evalThreshVal.textContent = 'Not Configured';

      DOM.kpiEvalBadge.textContent = 'NOT CONFIGURED';
      DOM.kpiEvalBadge.className = 'kpi-badge badge-amber';
      DOM.kpiEvalVal.textContent = 'NOT CONFIGURED';
      DOM.kpiEvalVal.className = 'kpi-primary-val evaluation-text unconfigured';
      DOM.kpiEvalSub.textContent = 'No verified applicable threshold enabled';

      DOM.lcdVerdictTag.textContent = 'NOT CONFIGURED';
      DOM.lcdVerdictTag.className = 'strip-val verdict-badge-lcd unconfigured';
      return;
    }

    // Threshold IS explicitly configured:
    const limit = AppState.configuredLimit;
    DOM.evalThreshVal.textContent = `${limit.toFixed(1)} µA (${AppState.standardPreset.toUpperCase()})`;

    if (measuredCurrent <= limit) {
      AppState.lastVerdict = 'PASS';
      DOM.evalResultBadge.textContent = 'PASS';
      DOM.evalResultBadge.className = 'eval-badge-pill pass';
      DOM.evalResultDesc.innerHTML = `<strong>PASS (SIMULATED):</strong> Measured leakage current of <strong>${measuredCurrent.toFixed(1)} µA</strong> is within the configured limit of <strong>${limit.toFixed(1)} µA</strong>. <em>Note: Simulated educational result; does not certify real medical device safety.</em>`;

      DOM.kpiEvalBadge.textContent = 'PASS';
      DOM.kpiEvalBadge.className = 'kpi-badge badge-green';
      DOM.kpiEvalVal.textContent = 'PASS';
      DOM.kpiEvalVal.className = 'kpi-primary-val evaluation-text pass';
      DOM.kpiEvalSub.textContent = `Within limit (${measuredCurrent.toFixed(1)} ≤ ${limit.toFixed(1)} µA)`;

      DOM.lcdVerdictTag.textContent = 'PASS';
      DOM.lcdVerdictTag.className = 'strip-val verdict-badge-lcd pass';
    } else {
      AppState.lastVerdict = 'FAIL';
      DOM.evalResultBadge.textContent = 'FAIL';
      DOM.evalResultBadge.className = 'eval-badge-pill fail';
      DOM.evalResultDesc.innerHTML = `<strong>FAIL (SIMULATED):</strong> Measured leakage current of <strong>${measuredCurrent.toFixed(1)} µA</strong> exceeds the configured safety threshold of <strong>${limit.toFixed(1)} µA</strong>. Potential clinical macroshock/microshock hazard.`;

      DOM.kpiEvalBadge.textContent = 'FAIL';
      DOM.kpiEvalBadge.className = 'kpi-badge badge-red';
      DOM.kpiEvalVal.textContent = 'FAIL';
      DOM.kpiEvalVal.className = 'kpi-primary-val evaluation-text fail';
      DOM.kpiEvalSub.textContent = `Exceeds limit (${measuredCurrent.toFixed(1)} > ${limit.toFixed(1)} µA)`;

      DOM.lcdVerdictTag.textContent = 'FAIL';
      DOM.lcdVerdictTag.className = 'strip-val verdict-badge-lcd fail';
    }
  }

  /* ==========================================================================
     TEST HISTORY & AUDIT TRAIL PERSISTENCE (LOCALSTORAGE & CSV)
     ========================================================================== */
  function logTestResultRecord() {
    const testDef = TEST_DEFINITIONS[AppState.selectedTestKey] || TEST_DEFINITIONS.earth_nc;
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();

    const record = {
      id: 'TEST-' + String(AppState.historyRecords.length + 1).padStart(3, '0'),
      dateTime: `${dateStr} ${timeStr}`,
      category: testDef.name,
      condition: testDef.condition,
      measured: AppState.simulatedCurrent.toFixed(1) + ' µA',
      measuredRaw: AppState.simulatedCurrent,
      threshold: AppState.thresholdConfigured ? `${AppState.configuredLimit.toFixed(1)} µA` : 'Not Configured',
      verdict: AppState.lastVerdict
    };

    AppState.historyRecords.unshift(record);
    saveHistoryToStorage();
    renderHistoryTable();
  }

  function renderHistoryTable() {
    const tbody = DOM.historyTableBody;
    tbody.innerHTML = '';

    if (AppState.historyRecords.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row" id="empty-history-row">
          <td colspan="8">
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <p>No electrical safety tests logged yet.</p>
              <span class="empty-state-sub">Select a test from the console above and click "Start Test" to log simulated measurements.</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    AppState.historyRecords.forEach((item, index) => {
      const tr = document.createElement('tr');
      let badgeClass = 'table-badge unconfigured';
      if (item.verdict === 'PASS') badgeClass = 'table-badge pass';
      else if (item.verdict === 'FAIL') badgeClass = 'table-badge fail';

      tr.innerHTML = `
        <td><strong>${item.id}</strong></td>
        <td>${item.dateTime}</td>
        <td>${item.category}</td>
        <td><small>${item.condition}</small></td>
        <td><strong style="color: #00f2fe;">${item.measured}</strong></td>
        <td>${item.threshold}</td>
        <td><span class="${badgeClass}">${item.verdict}</span></td>
        <td>
          <button class="delete-row-btn" data-index="${index}" title="Delete this entry">✕</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Attach row delete event listeners
    tbody.querySelectorAll('.delete-row-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
        AppState.historyRecords.splice(idx, 1);
        saveHistoryToStorage();
        renderHistoryTable();
        showToast('Record deleted.', 'info');
      });
    });
  }

  function saveHistoryToStorage() {
    try {
      localStorage.setItem(AppState.historyKey, JSON.stringify(AppState.historyRecords));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  function loadHistoryFromStorage() {
    try {
      const stored = localStorage.getItem(AppState.historyKey);
      if (stored) {
        AppState.historyRecords = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('LocalStorage load failed:', e);
      AppState.historyRecords = [];
    }
    renderHistoryTable();
  }

  function exportTestHistoryCSV() {
    if (AppState.historyRecords.length === 0) {
      showToast('No test records available to export.', 'warning');
      return;
    }

    let csvContent = 'Test ID,Date Time,Test Category,Test Condition,Measured Value (uA),Configured Threshold,Safety Verdict,Disclaimer\r\n';

    AppState.historyRecords.forEach(r => {
      const cleanCat = `"${r.category}"`;
      const cleanCond = `"${r.condition}"`;
      const cleanThresh = `"${r.threshold}"`;
      const line = [
        r.id,
        `"${r.dateTime}"`,
        cleanCat,
        cleanCond,
        r.measuredRaw.toFixed(1),
        cleanThresh,
        r.verdict,
        '"Simulated educational measurement - Not for real clinical certification"'
      ].join(',');
      csvContent += line + '\r\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `electrical_safety_test_results_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Test audit log exported successfully as CSV.', 'info');
  }

  /* ==========================================================================
     UI WORKFLOW, HUD & THRESHOLD STATE UPDATES
     ========================================================================== */
  function updateWorkflowView() {
    const testDef = TEST_DEFINITIONS[AppState.selectedTestKey] || TEST_DEFINITIONS.earth_nc;

    // Update KPIs
    DOM.kpiTestBadge.textContent = testDef.name;
    DOM.kpiTestName.textContent = `${testDef.name} (${testDef.condition.split(' ')[0]})`;

    // Update 3D Floating Popup
    DOM.popupTestType.textContent = testDef.name.toUpperCase();
    DOM.popupCircuitTitle.textContent = `${testDef.name} — ${testDef.condition}`;
    DOM.popupCircuitDesc.textContent = testDef.description;
    DOM.popupActivePath.textContent = testDef.flowPath;

    // Update Digital Screen Mode Tags
    DOM.lcdModeTag.textContent = `MODE: ${testDef.name.toUpperCase()}`;
    DOM.lcdCondTag.textContent = `COND: ${testDef.condition.toUpperCase()}`;

    // Highlight Connected Cables
    if (AppState.cableGlowActive) {
      activateCablePathGlow(AppState.selectedTestKey);
    }
  }

  function updateThresholdUI() {
    const isEnabled = DOM.enableThresholdToggle.checked;
    AppState.thresholdConfigured = isEnabled;

    if (isEnabled) {
      DOM.thresholdFieldsContainer.style.display = 'block';
      DOM.configStatusTag.textContent = 'CONFIGURED';
      DOM.configStatusTag.className = 'config-status-badge configured';
      AppState.configuredLimit = parseFloat(DOM.thresholdLimitInput.value) || 100.0;
      DOM.lcdThresholdVal.textContent = `${AppState.configuredLimit.toFixed(1)} µA`;
    } else {
      DOM.thresholdFieldsContainer.style.display = 'none';
      DOM.configStatusTag.textContent = 'NOT CONFIGURED';
      DOM.configStatusTag.className = 'config-status-badge unconfigured';
      DOM.lcdThresholdVal.textContent = 'NONE (UNCONFIGURED)';
    }

    if (!AppState.testRunning) {
      evaluateSafetyCompliance(AppState.simulatedCurrent);
    }
  }

  function highlightActiveStep(stepNum) {
    const steps = [
      DOM.step1Tracker, DOM.step2Tracker, DOM.step3Tracker,
      DOM.step4Tracker, DOM.step5Tracker, DOM.step6Tracker
    ];
    steps.forEach((s, i) => {
      if (i + 1 < stepNum) {
        s.className = 'step-item completed';
      } else if (i + 1 === stepNum) {
        s.className = 'step-item active';
      } else {
        s.className = 'step-item';
      }
    });
  }

  /* Cable Glowing Current Animation */
  function activateCablePathGlow(testKey) {
    connectingCables.forEach(cable => {
      const isRelevant = cable.userData.testTypes && cable.userData.testTypes.includes(testKey);
      if (isRelevant) {
        cable.material.emissive.setHex(0x00f2fe);
        cable.material.emissiveIntensity = 0.7;
      } else {
        cable.material.emissive.setHex(0x000000);
        cable.material.emissiveIntensity = 0.0;
      }
    });
  }

  function deactivateCablePathGlow() {
    connectingCables.forEach(cable => {
      cable.material.emissive.setHex(0x000000);
      cable.material.emissiveIntensity = 0.0;
    });
  }

  /* ==========================================================================
     CAMERA PRESET TRANSITIONS (LERP SYSTEM)
     ========================================================================== */
  const CAMERA_PRESETS = {
    overview: {
      position: new THREE.Vector3(0, 1.85, 2.75),
      target: new THREE.Vector3(0, 0.95, 0)
    },
    monitor: {
      position: new THREE.Vector3(-0.55, 1.25, 0.85),
      target: new THREE.Vector3(-0.55, 1.15, 0.05)
    },
    analyzer: {
      position: new THREE.Vector3(0.55, 1.30, 0.85),
      target: new THREE.Vector3(0.55, 1.05, 0.05)
    },
    wiring: {
      position: new THREE.Vector3(0, 3.4, 0.25),
      target: new THREE.Vector3(0, 0.90, 0)
    }
  };

  function setCameraViewPreset(viewKey) {
    const preset = CAMERA_PRESETS[viewKey];
    if (!preset) return;

    AppState.cameraView = viewKey;
    AppState.cameraTransitioning = true;
    AppState.camTargetPos = preset.position.clone();
    AppState.camTargetLookAt = preset.target.clone();

    // Update active button state
    DOM.camButtons.forEach(btn => {
      if (btn.getAttribute('data-view') === viewKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  /* ==========================================================================
     EVENT LISTENERS & INTERACTION HANDLERS
     ========================================================================== */
  function setupEventListeners() {
    // 1. Camera View Preset Buttons
    DOM.camButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.getAttribute('data-view');
        setCameraViewPreset(view);
      });
    });

    DOM.resetCamBtn.addEventListener('click', () => {
      setCameraViewPreset('overview');
    });

    // 2. DUT Power Toggle
    DOM.hudPowerBtn.addEventListener('click', togglePatientMonitorPower);

    // 3. Test Circuit Glow Toggle
    DOM.hudGlowBtn.addEventListener('click', () => {
      AppState.cableGlowActive = !AppState.cableGlowActive;
      DOM.hudGlowBtn.classList.toggle('active', AppState.cableGlowActive);
      DOM.hudGlowBtn.querySelector('span:last-child').textContent = AppState.cableGlowActive ? 'ACTIVE' : 'OFF';
      if (AppState.cableGlowActive) {
        activateCablePathGlow(AppState.selectedTestKey);
      } else {
        deactivateCablePathGlow();
      }
    });

    // 4. Test Selection Dropdown
    DOM.testTypeSelect.addEventListener('change', (e) => {
      AppState.selectedTestKey = e.target.value;
      updateWorkflowView();
      resetTestExecution();
    });

    // 5. Polarity & PE Conditions
    DOM.mainsPolaritySelect.addEventListener('change', (e) => {
      AppState.mainsPolarity = e.target.value;
      renderAnalyzerDisplay(AppState.simulatedCurrent, AppState.testRunning ? 'TESTING...' : 'IDLE');
    });

    DOM.peConditionSelect.addEventListener('change', (e) => {
      AppState.peSwitch = e.target.value;
      if (AppState.peSwitch === 'open') {
        DOM.chkEarth.className = 'check-item warning';
        DOM.chkEarth.querySelector('.chk-icon').textContent = '⚠️';
        DOM.chkEarth.querySelector('.chk-text').textContent = 'Protective Earth Open (Single Fault Sim)';
      } else {
        DOM.chkEarth.className = 'check-item active';
        DOM.chkEarth.querySelector('.chk-icon').textContent = '✓';
        DOM.chkEarth.querySelector('.chk-text').textContent = 'Protective Earth Continuity Verified';
      }
      renderAnalyzerDisplay(AppState.simulatedCurrent, AppState.testRunning ? 'TESTING...' : 'IDLE');
    });

    // 6. Threshold Configuration Inputs
    DOM.enableThresholdToggle.addEventListener('change', updateThresholdUI);

    DOM.thresholdPresetSelect.addEventListener('change', (e) => {
      const preset = e.target.value;
      AppState.standardPreset = preset;
      if (preset === 'iec60601_class1_cf') {
        DOM.thresholdLimitInput.value = '10.0';
      } else if (preset === 'iec60601_class1_bf') {
        DOM.thresholdLimitInput.value = '100.0';
      } else if (preset === 'iec62353_recurrent') {
        DOM.thresholdLimitInput.value = '500.0';
      }
      updateThresholdUI();
    });

    DOM.thresholdLimitInput.addEventListener('input', updateThresholdUI);

    // 7. Testing Action Buttons
    DOM.btnStartTest.addEventListener('click', startTestExecution);
    DOM.btnStopTest.addEventListener('click', stopTestExecution);
    DOM.btnResetTest.addEventListener('click', resetTestExecution);

    // 8. Info Popup Close
    DOM.popupCloseBtn.addEventListener('click', () => {
      DOM.testInfoPopup.style.display = 'none';
    });

    // 9. History Table Actions
    DOM.btnExportCsv.addEventListener('click', exportTestHistoryCSV);
    DOM.btnClearHistory.addEventListener('click', () => {
      DOM.clearModal.style.display = 'flex';
    });
    DOM.modalCancelBtn.addEventListener('click', () => {
      DOM.clearModal.style.display = 'none';
    });
    DOM.modalConfirmBtn.addEventListener('click', () => {
      AppState.historyRecords = [];
      saveHistoryToStorage();
      renderHistoryTable();
      DOM.clearModal.style.display = 'none';
      showToast('All logged test history records cleared.', 'info');
    });

    // 10. Window Resize Handling
    window.addEventListener('resize', onWindowResize, false);

    // 11. 3D Raycasting Inspection on Mouse Move & Click
    renderer.domElement.addEventListener('pointermove', onPointerMove, false);
    renderer.domElement.addEventListener('click', onSceneObjectClick, false);
  }

  function togglePatientMonitorPower() {
    AppState.dutPower = !AppState.dutPower;

    if (AppState.dutPower) {
      DOM.hudPowerBtn.classList.add('on');
      DOM.hudPowerText.textContent = 'ON';
      DOM.kpiDutStatus.textContent = 'DUT: ON';
      DOM.kpiDutStatus.className = 'kpi-badge badge-green';
      DOM.mirrorDutStatus.textContent = 'DUT: RUNNING';
      DOM.mirrorDutStatus.style.color = '#22c55e';
      if (monitorPowerLedMesh) monitorPowerLedMesh.material.color.setHex(0x00e676);
      showToast('Patient Monitor powered ON.', 'info');
    } else {
      DOM.hudPowerBtn.classList.remove('on');
      DOM.hudPowerText.textContent = 'OFF';
      DOM.kpiDutStatus.textContent = 'DUT: OFF';
      DOM.kpiDutStatus.className = 'kpi-badge badge-grey';
      DOM.mirrorDutStatus.textContent = 'DUT: OFF';
      DOM.mirrorDutStatus.style.color = '#94a3b8';
      if (monitorPowerLedMesh) monitorPowerLedMesh.material.color.setHex(0x1e293b);

      if (AppState.testRunning) {
        stopTestExecution();
      }
      showToast('Patient Monitor powered OFF.', 'warning');
    }
  }

  function onWindowResize() {
    if (!renderer || !camera || !canvasContainer) return;
    const width = canvasContainer.clientWidth;
    const height = canvasContainer.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function onPointerMove(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([monitorGroup, analyzerGroup, phantomGroup], true);

    if (intersects.length > 0) {
      let topObj = intersects[0].object;
      while (topObj.parent && !['PatientMonitor', 'SafetyAnalyzer', 'PatientSimulator'].includes(topObj.name)) {
        topObj = topObj.parent;
      }

      if (topObj.name === 'PatientMonitor') {
        showInspectTag(e.clientX - rect.left, e.clientY - rect.top, 'Patient Monitor (DUT)', 'Simulated Class I, Type CF ME Equipment with 5-lead ECG');
      } else if (topObj.name === 'SafetyAnalyzer') {
        showInspectTag(e.clientX - rect.left, e.clientY - rect.top, 'Electrical Safety Analyzer (ESA)', 'IEC 60601-1 / IEC 62353 1000Ω MD Leakage Meter');
      } else if (topObj.name === 'PatientSimulator') {
        showInspectTag(e.clientX - rect.left, e.clientY - rect.top, 'Patient Simulator Accessory', 'Phantom signal generator for risk-free student demonstration');
      }
    } else {
      DOM.inspectTag.style.display = 'none';
    }
  }

  function onSceneObjectClick() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([monitorGroup, analyzerGroup], true);

    if (intersects.length > 0) {
      let topObj = intersects[0].object;
      while (topObj.parent && !['PatientMonitor', 'SafetyAnalyzer'].includes(topObj.name)) {
        topObj = topObj.parent;
      }

      if (topObj.name === 'PatientMonitor') {
        setCameraViewPreset('monitor');
      } else if (topObj.name === 'SafetyAnalyzer') {
        setCameraViewPreset('analyzer');
      }
    }
  }

  function showInspectTag(x, y, title, desc) {
    DOM.inspectTag.style.display = 'flex';
    DOM.inspectTag.style.left = `${x}px`;
    DOM.inspectTag.style.top = `${y}px`;
    DOM.inspectTitle.textContent = title;
    DOM.inspectDesc.textContent = desc;
  }

  /* Toast Notification Utility */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✓';
    else if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  /* ==========================================================================
     MAIN 3D ANIMATION & RENDERING LOOP
     ========================================================================== */
  function startAnimationLoop() {
    let lastTime = 0;

    function animate(currentTime) {
      animFrameId = requestAnimationFrame(animate);

      const delta = (currentTime - lastTime) * 0.001;
      lastTime = currentTime;
      const timeSec = currentTime * 0.001;

      // 1. Smooth Camera Transition (Lerp Interpolation)
      if (AppState.cameraTransitioning && AppState.camTargetPos && controls) {
        camera.position.lerp(AppState.camTargetPos, 0.05);
        controls.target.lerp(AppState.camTargetLookAt, 0.05);
        controls.update();

        if (camera.position.distanceTo(AppState.camTargetPos) < 0.01) {
          AppState.cameraTransitioning = false;
        }
      } else if (controls) {
        controls.update();
      }

      // 2. Animate Dynamic Canvas Textures
      updatePatientMonitorCanvas(timeSec);

      // 3. Dynamic Cable Pulse Glow during Active Testing
      if (AppState.cableGlowActive && AppState.testRunning) {
        const pulse = 0.5 + Math.sin(timeSec * 8) * 0.5;
        connectingCables.forEach(c => {
          if (c.userData.testTypes && c.userData.testTypes.includes(AppState.selectedTestKey)) {
            c.material.emissiveIntensity = 0.4 + pulse * 0.6;
          }
        });
      }

      // 4. Render 3D Scene
      renderer.render(scene, camera);
    }

    animate(0);
  }

  /* ==========================================================================
     START APPLICATION ON DOM READY
     ========================================================================== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApplication);
  } else {
    initApplication();
  }

})();
