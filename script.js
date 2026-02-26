const upload = document.getElementById("upload");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const downloadBtn = document.getElementById("download");

let session;

async function init() {
  // Load U²-Net ONNX model
  session = await ort.InferenceSession.create("./models/u2net.onnx", {
    executionProviders: ["wasm"] // use "webgl" if supported
  });
}

upload.onchange = async () => {
  const img = new Image();
  img.src = URL.createObjectURL(upload.files[0]);
  img.onload = async () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    // Preprocess: resize to 320x320, normalize
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = 320;
    tmpCanvas.height = 320;
    const tmpCtx = tmpCanvas.getContext("2d");
    tmpCtx.drawImage(img, 0, 0, 320, 320);
    const imgData = tmpCtx.getImageData(0, 0, 320, 320);

    const floatData = new Float32Array(1 * 3 * 320 * 320);
    for (let i = 0; i < 320 * 320; i++) {
      floatData[i] = imgData.data[i * 4] / 255.0;       // R
      floatData[i + 320 * 320] = imgData.data[i * 4+1] / 255.0; // G
      floatData[i + 2 * 320 * 320] = imgData.data[i * 4+2] / 255.0; // B
    }

    const tensor = new ort.Tensor("float32", floatData, [1, 3, 320, 320]);
    const results = await session.run({ input: tensor });
    const mask = results[Object.keys(results)[0]]; // main output mask

    // Apply mask to original image
    const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const origData = original.data;

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4;

        // Map coordinates to mask resolution (320x320)
        const maskX = Math.floor(x * 320 / canvas.width);
        const maskY = Math.floor(y * 320 / canvas.height);
        const maskIdx = maskY * 320 + maskX;

        const maskVal = mask.data[maskIdx]; // 0..1

        if (maskVal < 0.5) {
          // Background → transparent
          origData[idx + 3] = 0;
        } else {
          origData[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(original, 0, 0);
  };
};

downloadBtn.onclick = () => {
  const link = document.createElement("a");
  link.download = "output.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
};

init();
