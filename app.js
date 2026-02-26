const UI = {
    upload: document.getElementById("upload"),
    cameraBtn: document.getElementById("cameraBtn"),
    canvas: document.getElementById("canvas"),
    ctx: document.getElementById("canvas").getContext("2d"),
    cropBtn: document.getElementById("cropA4"),
    statusText: document.getElementById("status"),
    progressFill: document.getElementById("progress-fill"),
    fontPalette: document.getElementById("font-palette"),
    bgPalette: document.getElementById("bg-palette"),
    previewCanvas: document.getElementById("previewCanvas"),
    previewCtx: document.getElementById("previewCanvas").getContext("2d")
};

UI.cameraBtn = document.getElementById("cameraBtn");
UI.video = document.getElementById("video");
UI.captureBtn = document.getElementById("captureBtn");
UI.cameraContainer = document.getElementById("camera-container");
UI.cancelBtn = document.getElementById("cancelBtn");

UI.cameraBtn.onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false
        });

        UI.video.srcObject = stream;

        // Show the camera UI and hide the initial camera button
        UI.cameraContainer.style.display = "block";
        UI.cameraBtn.style.display = "none";

        updateProgress("Camera Live", 100);
    } catch (err) {
        console.error("Camera error: ", err);
        alert("Camera access denied or not available.");
    }
};

function stopCamera() {
    const stream = UI.video.srcObject;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    UI.cameraContainer.style.display = "none";
}

UI.cancelBtn.onclick = stopCamera;

UI.captureBtn.onclick = async () => {
    // 1. Snapshot
    UI.canvas.width = UI.video.videoWidth;
    UI.canvas.height = UI.video.videoHeight;
    UI.ctx.drawImage(UI.video, 0, 0);
    
    // 2. Cleanup
    stopCamera();

    // 3. Process
    await runAIWorkflow();
};

/**
 * Specifically for Camera: Starts processing from the existing UI.canvas
 */
async function processCapturedFrame() {
    updateProgress("AI Processing...", 40);

    // Since the image is already on UI.canvas, we pass the canvas to ColorThief
    // and run the U2Net logic exactly like the file upload does.

    // --- [INSERT YOUR U2NET MASK LOGIC HERE] ---
    // (Use the same logic from your upload.onchange to generate the alpha mask)

    // After mask is applied:
    generateUIColors(UI.canvas);
    pickRandomPhrase();
    renderMagazine();

    updateProgress("Magazine Generated", 100);
    UI.cropBtn.disabled = false;
}


let session;
let selectedColor = "#f0f0f0";
let unifiedFontColor = "#000000";
let magazinePhrases = [];
let currentPhrases = { headline: "ESPERANDO", subtitle: "Abra uma imagem para começar" };

const colorThief = new ColorThief();
const MODEL_SIZE = 320;

// --- INITIALIZATION ---
async function init() {
    updateProgress("Carregando frases...", 10);
    await loadPhrases();
    try {
        updateProgress("Iniciando modelo de IA...", 30);
        session = await ort.InferenceSession.create("./models/u2net.onnx", { executionProviders: ["wasm"] });
        updateProgress("App pronto", 100);
    } catch (e) {
        updateProgress("Erro ao carregar o modelo", 0);
        console.error(e);
    }
}

async function loadPhrases() {
    try {
        const response = await fetch('frases.txt');
        const text = await response.text();
        magazinePhrases = text.split('\n')
            .filter(line => line.includes(';'))
            .map(line => {
                const [headline, subtitle] = line.split(';');
                return { headline: headline.trim(), subtitle: subtitle.trim() };
            });
    } catch (e) { console.error("Não foi possível carregar frases.txt"); }
}

function pickRandomPhrase() {
    if (magazinePhrases.length > 0) {
        currentPhrases = magazinePhrases[Math.floor(Math.random() * magazinePhrases.length)];
    }
}

function updateProgress(text, percent = 0) {
    // Ensure status text uses the customizer-label style and uppercase formatting
    if (UI.statusText) {
        UI.statusText.className = 'customizer-label';
        UI.statusText.textContent = String(text).toUpperCase();
    }
    if (UI.progressFill) UI.progressFill.style.width = (percent || 0) + "%";
}

// --- COLOR ENGINE ---
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) h = s = 0;
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function generateUIColors(sourceCanvas) {
    // 1. Extract 6 colors from the subject
    const palette = colorThief.getPalette(sourceCanvas, 5);
    const palette_bg = colorThief.getPalette(sourceCanvas, 6);
    const hexPalette = palette.map(rgb => rgbToHex(...rgb));

    // 2. Calculate the "Magic" Unified Color once and STORE IT
    const magicColor = getUnifiedComplementaryColor(hexPalette);
    unifiedFontColor = magicColor; // Set as default

    // 3. Clear and Rebuild Font Palette
    UI.fontPalette.innerHTML = "";

    // --- OPTION 1: THE MAGIC COLOR ---
    const magicSwatch = createSwatch(magicColor, () => {
        unifiedFontColor = magicColor; // Now it can return to exactly this color
        renderMagazine();
    });
    magicSwatch.classList.add('active'); // Mark as default
    // Add a small indicator or title so you know this is the "Auto" choice
    magicSwatch.title = "Cor recomendada";
    UI.fontPalette.appendChild(magicSwatch);

    // --- OPTIONS 2-6: THE INVERTED VARIANTS ---
    // We skip the first palette color to avoid redundancy if it matches the magic logic
    palette.slice(0, 5).forEach((rgb) => {
        // Restoring your original math:
        const invR = 255 - rgb[0];
        const invG = 255 - rgb[1];
        const invB = 255 - rgb[2];

        // Convert back to Hex for the swatch
        const rgbHex = `#${((1 << 24) + (invR << 16) + (invG << 8) + invB).toString(16).slice(1)}`;

        const swatch = createSwatch(rgbHex, () => {
            unifiedFontColor = rgbHex;
            renderMagazine();
        });
        UI.fontPalette.appendChild(swatch);
    });

    // 4. Background Palette (Pastel Tints)
    UI.bgPalette.innerHTML = "";
    palette_bg.forEach((rgb, i) => {
        const [h, s, l] = rgbToHsl(...rgb);
        const tint = `hsl(${Math.round(h)}, ${Math.round(s * 0.5)}%, 94%)`;
        const bgSwatch = createSwatch(tint, () => {
            selectedColor = tint;
            renderMagazine();
        });
        if (i === 0) {
            selectedColor = tint;
            bgSwatch.classList.add('active');
        }
        UI.bgPalette.appendChild(bgSwatch);
    });

    // Save for debugger
    window.lastExtractedPalette = palette;
}

function getUnifiedComplementaryColor(hexColors) {
    let totalR = 0, totalG = 0, totalB = 0;

    hexColors.forEach(hex => {
        hex = hex.replace(/^#/, '');
        totalR += parseInt(hex.substring(0, 2), 16);
        totalG += parseInt(hex.substring(2, 4), 16);
        totalB += parseInt(hex.substring(4, 6), 16);
    });

    const avgR = totalR / hexColors.length;
    const avgG = totalG / hexColors.length;
    const avgB = totalB / hexColors.length;

    let [h, s, l] = rgbToHsl(avgR, avgG, avgB);

    // THE MAGIC STEPS:
    h = (h + 180) % 360; // Rotate Hue
    s = Math.max(s, 75);  // Boost Saturation
    l = l > 50 ? 25 : 85; // High Contrast Readability

    return hslToHex(h, s, l);
}

function createSwatch(color, callback) {
    const div = document.createElement("div");
    div.className = "color-swatch";
    div.style.backgroundColor = color;
    div.onclick = () => {
        div.parentElement.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        div.classList.add('active');
        callback();
    };
    return div;
}

// --- TYPOGRAPHY ENGINE ---
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    text = text.toUpperCase();
    const words = text.split(' ');
    let line = '';
    let testY = y;
    for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            ctx.fillText(line, x, testY);
            line = words[n] + ' ';
            testY += lineHeight;
        } else { line = testLine; }
    }
    ctx.fillText(line, x, testY);
    return testY;
}

function drawBalancedHeadline(ctx, text, x, y, maxWidth, lineHeight) {
    text = text.toUpperCase();
    const words = text.split(' ');
    let midPoint = text.length / 2;
    let charCount = 0, splitIndex = words.length - 1;
    for (let i = 0; i < words.length; i++) {
        charCount += words[i].length + 1;
        if (charCount >= midPoint) { splitIndex = i; break; }
    }
    const line1 = words.slice(0, splitIndex + 1).join(' ').trim();
    const line2 = words.slice(splitIndex + 1).join(' ').trim();
    ctx.fillText(line1, x, y);
    if (line2) ctx.fillText(line2, x, y + lineHeight);
    return line2 ? y + (lineHeight * 2) : y + lineHeight;
}

// --- RENDER ENGINE ---
function drawMagazineDesign(targetCanvas) {
    const ctx = targetCanvas.getContext("2d");
    const w = targetCanvas.width;
    const h = targetCanvas.height;
    const padding = w * 0.1;
    const maxWidth = w - (padding * 2);

    ctx.fillStyle = selectedColor;
    ctx.fillRect(0, 0, w, h);

    const scale = Math.max(w / UI.canvas.width, h / UI.canvas.height);
    const drawW = UI.canvas.width * scale;
    const drawH = UI.canvas.height * scale;
    ctx.drawImage(UI.canvas, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);

    ctx.save();
    ctx.fillStyle = unifiedFontColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.shadowBlur = 0;

    // Header Logo
    ctx.font = `900 ${Math.round(w * 0.19)}px 'Merriweather', serif`;
    ctx.fillText("Forbes", w / 2, h * 0.04);

    // Balanced Headline
    const headSize = Math.round(w * 0.05);
    const headLH = headSize * 1.2;
    ctx.font = `900 ${headSize}px 'Merriweather', serif`;
    const txt = currentPhrases.headline.toUpperCase();
    let curY = h * 0.84;

    if (ctx.measureText(txt).width > maxWidth) {
        curY = drawBalancedHeadline(ctx, txt, w / 2, curY, maxWidth, headLH);
    } else {
        ctx.fillText(txt, w / 2, curY);
        curY += headLH;
    }

    // Subtitle in Work Sans
    const subSize = Math.round(w * 0.024);
    ctx.font = `600 ${subSize}px 'Work Sans', sans-serif`;
    wrapText(ctx, currentPhrases.subtitle, w / 2, curY + 15, maxWidth, subSize * 1.4);

    ctx.restore();
}

function renderMagazine() {
    UI.previewCanvas.width = 1240;
    UI.previewCanvas.height = 1754;
    drawMagazineDesign(UI.previewCanvas);
    // Auto-debug every time the magazine re-renders
    debugState();
}

// --- IMAGE PROCESSING ---
UI.upload.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) processImage(URL.createObjectURL(file));
};

async function runAIWorkflow() {
    updateProgress("Removendo fundo...", 40);

    // 1. --- AI Background Removal ---
    // We use UI.canvas as the source for the 320x320 input
    const off = document.createElement("canvas");
    off.width = off.height = 320;
    const octx = off.getContext("2d");
    octx.drawImage(UI.canvas, 0, 0, 320, 320); // Source is now the canvas

    const data = octx.getImageData(0, 0, 320, 320).data;
    const f = new Float32Array(3 * 320 * 320);
    for (let i = 0; i < 320 * 320; i++) {
        f[0 * 320 * 320 + i] = ((data[i * 4 + 0] / 255) - 0.485) / 0.229;
        f[1 * 320 * 320 + i] = ((data[i * 4 + 1] / 255) - 0.456) / 0.224;
        f[2 * 320 * 320 + i] = ((data[i * 4 + 2] / 255) - 0.406) / 0.225;
    }

    const results = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", f, [1, 3, 320, 320]) });
    const mask = results[session.outputNames[0]].data;

    const orig = UI.ctx.getImageData(0, 0, UI.canvas.width, UI.canvas.height);
    for (let y = 0; y < UI.canvas.height; y++) {
        for (let x = 0; x < UI.canvas.width; x++) {
            const idx = (y * UI.canvas.width + x) * 4;
            const mX = (x * 319) / UI.canvas.width, mY = (y * 319) / UI.canvas.height;
            const x0 = Math.floor(mX), y0 = Math.floor(mY);
            let alpha = mask[y0 * 320 + x0];
            alpha = 1 / (1 + Math.exp(-12 * (alpha - 0.5)));
            orig.data[idx + 3] = alpha * 255;
        }
    }
    UI.ctx.putImageData(orig, 0, 0);

    // 2. --- Styling & Rendering ---
    updateProgress("Extraindo cores da foto...", 85);
    generateUIColors(UI.canvas);
    pickRandomPhrase();
    renderMagazine();

    updateProgress("Arte pronta pra impressão!", 100);
    UI.cropBtn.disabled = false;
}

async function processImage(src) {
    const img = new Image();
    img.src = src;
    img.onload = async () => {
        UI.canvas.width = img.width;
        UI.canvas.height = img.height;
        UI.ctx.drawImage(img, 0, 0);

        // Call the shared workflow
        await runAIWorkflow();
    };
}

/**
 * CAMERA CAPTURE HANDLER
 */
UI.captureBtn.onclick = async () => {
    // 1. Snap photo from video to canvas
    UI.canvas.width = UI.video.videoWidth;
    UI.canvas.height = UI.video.videoHeight;
    UI.ctx.drawImage(UI.video, 0, 0);

    // 2. Stop camera
    const stream = UI.video.srcObject;
    stream.getTracks().forEach(track => track.stop());
    UI.cameraContainer.style.display = "none";
    UI.cameraBtn.style.display = "block";

    // 3. Call the shared workflow
    await runAIWorkflow();
};



// --- ACTIONS ---
UI.cropBtn.onclick = () => {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = 2480; exportCanvas.height = 3508;
    drawMagazineDesign(exportCanvas);
    const link = document.createElement("a");
    link.download = `magazine-cover-${Date.now()}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
};

document.getElementById("nextPhrase").onclick = () => {
    pickRandomPhrase();
    renderMagazine();
};

function debugState() {
    console.log("%c ⚡ MAGAZINE ENGINE DEBUG ⚡ ", "background: #000; color: #fff; font-weight: bold; padding: 4px;");

    // 1. Core Variables Table
    console.table({
        "Background (selectedColor)": selectedColor,
        "Font (unifiedFontColor)": unifiedFontColor,
        "Headline": currentPhrases.headline,
        "Subtitle": currentPhrases.subtitle
    });

    // 2. Color Analysis
    const fontHsl = hexToHsl(unifiedFontColor);
    const bgHsl = hexToHsl(selectedColor);

    console.log(`%c Font HSL: h:${fontHsl[0]} s:${fontHsl[1]}% l:${fontHsl[2]}% `, `border-left: 5px solid ${unifiedFontColor}; padding-left: 10px;`);
    console.log(`%c Back HSL: h:${bgHsl[0]} s:${bgHsl[1]}% l:${bgHsl[2]}% `, `border-left: 5px solid ${selectedColor}; padding-left: 10px;`);

    // 3. Subject Palette Analysis (if colorThief has run)

    console.log("Subject Extracted Palette:");
    window.lastExtractedPalette.forEach((rgb, i) => {
        const hex = rgbToHex(...rgb);
        console.log(`%c Color ${i + 1}: ${hex} `, `background: ${hex}; color: ${hexToHsl(hex)[2] > 50 ? '#000' : '#fff'}; padding: 2px;`);
    });

}

// Helper to convert hex back to HSL for debug reading
function hexToHsl(hex) {
    hex = hex.replace(/^#/, '');
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    return rgbToHsl(r, g, b).map(val => Math.round(val));
}

init();

// Long-press tooltip support for touch devices: shows aria-label on press-and-hold
function setupLongPressTooltips() {
    const buttons = document.querySelectorAll('button[aria-label]');
    let timer = null;
    let tooltip = null;

    function createTooltip(text){
        if (tooltip) tooltip.remove();
        tooltip = document.createElement('div');
        tooltip.className = 'longpress-tooltip';
        tooltip.textContent = text;
        document.body.appendChild(tooltip);
        return tooltip;
    }

    function showFor(btn){
        const text = btn.getAttribute('aria-label') || btn.title || '';
        if (!text) return;
        const t = createTooltip(text);
        const r = btn.getBoundingClientRect();
        const left = Math.round(r.left + r.width/2);
        const top = Math.round(r.top) - 8; // place above
        t.style.left = left + 'px';
        t.style.top = top + 'px';
        // small delay to allow layout then show
        requestAnimationFrame(()=> t.classList.add('show'));
    }

    function hide(){
        if (tooltip) { tooltip.classList.remove('show'); setTimeout(()=>{ if(tooltip) tooltip.remove(); tooltip = null; }, 120); }
        if (timer) { clearTimeout(timer); timer = null; }
    }

    buttons.forEach(btn => {
        btn.addEventListener('touchstart', (e) => {
            timer = setTimeout(()=> showFor(btn), 600);
        }, {passive:true});
        btn.addEventListener('touchend', hide);
        btn.addEventListener('touchcancel', hide);

        // Desktop long-press (optional)
        btn.addEventListener('mousedown', (e) => {
            timer = setTimeout(()=> showFor(btn), 800);
        });
        btn.addEventListener('mouseup', hide);
        btn.addEventListener('mouseleave', hide);
    });
}

setupLongPressTooltips();