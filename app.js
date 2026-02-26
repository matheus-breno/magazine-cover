const UI = {
    upload: document.getElementById("upload"),
    canvas: document.getElementById("canvas"),
    ctx: document.getElementById("canvas").getContext("2d"),
    downloadBtn: document.getElementById("download"),
    cropBtn: document.getElementById("cropA4"),
    statusText: document.getElementById("status"),
    spinner: document.getElementById("spinner"),
    paletteContainer: document.getElementById("palette"),
    originalRow: document.getElementById("original-row"),
    inverseRow: document.getElementById("inverse-row"),
    fontColorPreview: document.getElementById("font-color-preview"),
    previewCanvas: document.getElementById("previewCanvas"),
    previewCtx: document.getElementById("previewCanvas").getContext("2d"),
    mainColorPreview: document.getElementById("main-color-preview")
};

let session;
let selectedColor = "#f0f0f0";
let unifiedFontColor = "#000000";
const colorThief = new ColorThief();
const MODEL_SIZE = 320;

async function init() {
    try {
        session = await ort.InferenceSession.create("./models/u2net.onnx", { executionProviders: ["wasm"] });
        UI.statusText.innerText = "Model Ready. Upload an image.";
    } catch (e) { UI.statusText.innerText = "Error loading model."; }
}

const rgbToHex = (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();

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

function getUnifiedComplementaryColor(hexColors) {
    let totalR = 0, totalG = 0, totalB = 0;
    hexColors.forEach(hex => {
        hex = hex.replace(/^#/, '');
        totalR += parseInt(hex.substring(0, 2), 16);
        totalG += parseInt(hex.substring(2, 4), 16);
        totalB += parseInt(hex.substring(4, 6), 16);
    });
    let avgR = Math.round(totalR / hexColors.length);
    let avgG = Math.round(totalG / hexColors.length);
    let avgB = Math.round(totalB / hexColors.length);
    return "#" + (255 - avgR).toString(16).padStart(2, '0') + (255 - avgG).toString(16).padStart(2, '0') + (255 - avgB).toString(16).padStart(2, '0').toUpperCase();
}

function renderMagazine() {
    const pCanvas = UI.previewCanvas;
    const pCtx = UI.previewCtx;
    
    // Set internal resolution (A4)
    pCanvas.width = 1240; 
    pCanvas.height = 1754;

    // 1. Fill background with your pastel tint
    pCtx.fillStyle = selectedColor;
    pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);

    // 2. CALCULATE COVER SCALE (Ensures no white space)
    const scaleW = pCanvas.width / UI.canvas.width;
    const scaleH = pCanvas.height / UI.canvas.height;
    
    // Use the larger scale to ensure the canvas is completely covered
    const scale = Math.max(scaleW, scaleH);
    
    const drawW = UI.canvas.width * scale;
    const drawH = UI.canvas.height * scale;

    // Center the image so the crop is even on all sides
    const offsetX = (pCanvas.width - drawW) / 2;
    const offsetY = (pCanvas.height - drawH) / 2;

    // 3. Draw the scaled image
    pCtx.drawImage(UI.canvas, offsetX, offsetY, drawW, drawH);

    // 4. Typography (Title)
    pCtx.fillStyle = unifiedFontColor;
    pCtx.font = "900 240px 'Merriweather', serif";
    pCtx.textAlign = "center";
    pCtx.textBaseline = "top";
    pCtx.fillText("Forbes", pCanvas.width / 2, 80);

    // 5. Typography (Headline)
    pCtx.font = "900 50px 'Merriweather', serif";
    pCtx.fillText("O HOMEM QUE MUDOU O MUNDO... PRA PIOR", pCanvas.width / 2, pCanvas.height - 250);
    
    pCtx.font = "italic 400 32px 'Merriweather', serif";
    pCtx.fillText("Entenda como ele fez isso e porque ainda não está preso", pCanvas.width / 2, pCanvas.height - 180);
}

UI.upload.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = async () => {
        UI.spinner.style.display = "block";
        UI.statusText.innerText = "AI Processing: Removing Background...";
        
        UI.canvas.width = img.width; UI.canvas.height = img.height;
        UI.ctx.drawImage(img, 0, 0);

        // --- START AI BACKGROUND REMOVAL ---
        const offscreen = document.createElement("canvas");
        offscreen.width = MODEL_SIZE; offscreen.height = MODEL_SIZE;
        const oCtx = offscreen.getContext("2d");
        oCtx.drawImage(img, 0, 0, MODEL_SIZE, MODEL_SIZE);
        
        const imgData = oCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
        const floatData = new Float32Array(3 * MODEL_SIZE * MODEL_SIZE);

        // Normalize image for U2Net (Standard ImageNet mean/std)
        for (let i = 0; i < MODEL_SIZE * MODEL_SIZE; i++) {
            floatData[0 * 320 * 320 + i] = ((imgData[i * 4 + 0] / 255) - 0.485) / 0.229;
            floatData[1 * 320 * 320 + i] = ((imgData[i * 4 + 1] / 255) - 0.456) / 0.224;
            floatData[2 * 320 * 320 + i] = ((imgData[i * 4 + 2] / 255) - 0.406) / 0.225;
        }

        const inputTensor = new ort.Tensor("float32", floatData, [1, 3, 320, 320]);
        const results = await session.run({ [session.inputNames[0]]: inputTensor });
        const mask = results[session.outputNames[0]].data;

        const original = UI.ctx.getImageData(0, 0, UI.canvas.width, UI.canvas.height);
        for (let y = 0; y < UI.canvas.height; y++) {
            for (let x = 0; x < UI.canvas.width; x++) {
                const idx = (y * UI.canvas.width + x) * 4;
                const mX = (x * 319) / UI.canvas.width;
                const mY = (y * 319) / UI.canvas.height;
                const x0 = Math.floor(mX), y0 = Math.floor(mY), x1 = Math.min(x0+1, 319), y1 = Math.min(y0+1, 319);
                const dx = mX - x0, dy = mY - y0;
                
                let alpha = mask[y0*320+x0]*(1-dx)*(1-dy) + mask[y0*320+x1]*dx*(1-dy) + mask[y1*320+x0]*(1-dx)*dy + mask[y1*320+x1]*dx*dy;
                // Apply sigmoid-like sharpening to the mask
                alpha = 1 / (1 + Math.exp(-12 * (alpha - 0.5)));
                original.data[idx+3] = alpha * 255;
            }
        }
        UI.ctx.putImageData(original, 0, 0);
        // --- END AI BACKGROUND REMOVAL ---

        UI.statusText.innerText = "Generating Palette...";

        const mainRgb = colorThief.getColor(img);
        const palette = colorThief.getPalette(img, 5);
        
        const mainHex = rgbToHex(...mainRgb);
        UI.mainColorPreview.style.backgroundColor = mainHex;

        UI.originalRow.innerHTML = "";
        UI.inverseRow.innerHTML = "";
        palette.forEach(rgb => {
            const hex = rgbToHex(...rgb);
            const invR = 255 - rgb[0], invG = 255 - rgb[1], invB = 255 - rgb[2];
            const invHex = rgbToHex(invR, invG, invB);

            const oBox = document.createElement("div");
            oBox.className = "debug-box"; oBox.style.backgroundColor = hex; oBox.innerHTML = `ORIG<br>${hex}`;
            UI.originalRow.appendChild(oBox);

            const iBox = document.createElement("div");
            iBox.className = "debug-box"; iBox.style.backgroundColor = invHex; iBox.innerHTML = `INV<br>${invHex}`;
            UI.inverseRow.appendChild(iBox);
        });
        
        const hexPalette = palette.map(rgb => rgbToHex(...rgb));
        unifiedFontColor = getUnifiedComplementaryColor(hexPalette);
        UI.fontColorPreview.style.backgroundColor = unifiedFontColor;

        UI.paletteContainer.innerHTML = "";
        palette.forEach((rgb, i) => {
            const [h, s, l] = rgbToHsl(...rgb);
            const tint = `hsl(${Math.round(h)}, ${Math.round(s * 0.7)}%, 94%)`;
            const swatch = document.createElement("div");
            swatch.className = "color-swatch" + (i === 0 ? " active" : "");
            swatch.style.backgroundColor = tint;
            if (i === 0) selectedColor = tint;
            swatch.onclick = () => {
                selectedColor = tint;
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                renderMagazine(); 
            };
            UI.paletteContainer.appendChild(swatch);
        });
                
        UI.spinner.style.display = "none";
        UI.statusText.innerText = "Processing Complete.";
        UI.downloadBtn.disabled = UI.cropBtn.disabled = false;
        renderMagazine();
    };
};

// ... keep your UI.cropBtn.onclick and init() exactly as you had them ...

UI.cropBtn.onclick = () => {
    const a4W = 2480; // 300 DPI Width
    const a4H = 3508; // 300 DPI Height
    const mag = document.createElement("canvas");
    mag.width = a4W;
    mag.height = a4H;
    const mCtx = mag.getContext("2d");

    // 1. Draw Background (in case of transparent edges)
    mCtx.fillStyle = selectedColor;
    mCtx.fillRect(0, 0, a4W, a4H);

    // 2. CALCULATE FULL-BLEED (COVER) SCALE
    // We scale the image so it perfectly fits the WIDTH of the A4 page
    const scale = a4W / UI.canvas.width;
    const drawW = UI.canvas.width * scale;
    const drawH = UI.canvas.height * scale;

    // Center vertically: if the scaled image is taller than A4, 
    // it will crop the top/bottom equally.
    const offsetX = 0; 
    const offsetY = (a4H - drawH) / 2;

    // 3. DRAW IMAGE (Full Bleed)
    mCtx.drawImage(UI.canvas, offsetX, offsetY, drawW, drawH);

    // 4. DRAW TITLE (VOGUE)
    // Positioned at the top
    mCtx.fillStyle = unifiedFontColor;
    mCtx.font = "900 380px 'Merriweather', serif";
    mCtx.textAlign = "center";
    mCtx.textBaseline = "top";
    mCtx.fillText("Forbes", a4W / 2, 150);

    // 5. DRAW HEADLINE (At the Bottom)
    // We use a slight shadow to ensure legibility over the image
    mCtx.shadowColor = "rgba(0,0,0,0.3)";
    mCtx.shadowBlur = 15;
    
    // Main Headline
    mCtx.font = "900 130px 'Merriweather', serif";
    mCtx.fillText("O HOMEM QUE MUDOU O MUNDO... PRA PIOR", a4W / 2, a4H - 500);

    // Sub-headline
    mCtx.shadowBlur = 0; // Disable shadow for smaller text
    mCtx.font = "italic 400 65px 'Merriweather', serif";
    mCtx.fillText("Entenda como ele fez isso e porque ainda não está preso", a4W / 2, a4H - 350);

    // 6. EXPORT
    const link = document.createElement("a");
    link.download = "magazine-a4-cover.png";
    link.href = mag.toDataURL("image/png");
    link.click();
};

init();